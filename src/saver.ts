import * as path from 'path'
import * as _ from 'lodash'
import {
  Bucket,
  CreateWriteStreamOptions,
  Storage
} from '@google-cloud/storage'
import { v5 as uuidv5 } from 'uuid'
import { from, MonoTypeOperatorFunction, EMPTY, of, throwError } from 'rxjs'
import {
  retry,
  map,
  tap,
  delay,
  filter,
  catchError,
  mergeMap
} from 'rxjs/operators'
import axios, { AxiosResponse } from 'axios'
import { httpsAgent, userAgent } from './fetch'
import { retryWithDelay } from '../src/operators'
import Jimp = require('jimp/dist')
import * as xlsx from 'xlsx-populate'
import { drive_v3, google, sheets_v4 } from 'googleapis'
import { OAuth2Client, JWT } from 'google-auth-library'
import * as moment from 'moment'
import * as fs from 'fs-extra'
import * as archiver from 'archiver'
import { concatMap, mapTo } from 'rxjs/operators'
import * as mime from 'mime-types'
type RawRow<T> =
  | { [P in keyof T]: (string | number | { formula: string })[] }
  | {}
type RawData<T> =
  | { [P in keyof T]: (string | number | { formula: string })[][] }
  | {}

class Auth {
  private static auth = new Auth()
  private constructor() {}
  static get instance() {
    return this.auth
  }

  static readonly SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
  static readonly KEY_PATH = path.join(
    __dirname,
    '../data/service_account.json'
  )

  private auth: OAuth2Client = null
  fetchAuth = () =>
    this.auth
      ? Promise.resolve(this.auth)
      : fs
          .readJSON(Auth.KEY_PATH)
          .then(key => {
            const { client_email, private_key } = key
            const oAuth2Client = new google.auth.JWT(
              client_email,
              null,
              private_key,
              Auth.SCOPES
            )

            return oAuth2Client
              .authorize()
              .then(() => (this.auth = oAuth2Client as any))
          })
          .catch(err => {
            return Promise.reject('Error loading client secret file:' + err)
          })

  private sheets: sheets_v4.Sheets
  fetchSheets = () =>
    this.sheets
      ? Promise.resolve(this.sheets)
      : this.fetchAuth().then(() => {
          this.sheets = google.sheets({
            version: 'v4',
            auth: this.auth as any
          })
          return this.sheets
        })

  private drive: drive_v3.Drive = null
  fetchDrive = () =>
    this.drive
      ? Promise.resolve(this.drive)
      : Auth.instance.fetchAuth().then(
          () =>
            (this.drive = google.drive({
              version: 'v3',
              auth: this.auth as any
            }))
        )
}

export class SpreadSheet {
  constructor(private spreadsheetId: string) {}

  getCells = (range: string) =>
    Auth.instance
      .fetchSheets()
      .then(sheets =>
        sheets.spreadsheets.values.get({
          spreadsheetId: this.spreadsheetId,
          range,
          fields: 'values'
        })
      )
      .then(({ data }) => data.values)
  updateCell = <Value>(range: string, val: Value[][]) =>
    Auth.instance.fetchSheets().then(sheets =>
      sheets.spreadsheets.values.update({
        range,
        spreadsheetId: this.spreadsheetId,
        requestBody: { values: val },
        valueInputOption: 'RAW'
      })
    )
}
export class Workbook<SheetNames extends { [key: string]: string }> {
  private worksheets: { [P in keyof SheetNames]: xlsx.Sheet }
  private rowCount = 1
  private constructor(private workbook: xlsx.Workbook, sheetNames: SheetNames) {
    this.worksheets = _.mapValues(
      sheetNames,
      name =>
        workbook.sheets().find(sheet => sheet.name() === name) ||
        workbook.addSheet(name)
    )
  }

  static async fromBlank<SheetNames extends { [key: string]: string }>(
    sheetNames: SheetNames
  ) {
    const wb = await xlsx.fromBlankAsync()
    const workbook = new Workbook(wb, sheetNames)
    workbook.workbook.deleteSheet('Sheet1')
    return workbook
  }

  static async fromData<SheetNames extends { [key: string]: string }>(
    buf: Buffer,
    sheetNames: SheetNames
  ) {
    const wb = await xlsx.fromDataAsync(buf)
    return new Workbook(wb, sheetNames)
  }

  appendRow(
    new_row: {
      [key in keyof SheetNames]:
        | {
            [key: number]: string | number | { f: string } | void
          }
        | string[]
    }
  ) {
    const rows = _.mapValues(new_row, (data, key) => {
      if (!(key in this.worksheets)) return null

      const row = this.worksheets[key].row(this.rowCount)
      for (const i in data) {
        const v = data[i]
        if (v === null || v === undefined) {
          row.cell(+i + 1).value('')
        } else if (v instanceof Object) {
          if (v.f)
            row.cell(+i + 1).formula(v.f[0] === '=' ? v.f.substr(1) : v.f)
        } else if (_.isNumber(v) || _.isString(v)) {
          row.cell(+i + 1).value(v)
        } else {
          row.cell(+i + 1).value(String(v))
        }
      }
      row.height(15)
      return row
    })
    ++this.rowCount
    return rows
  }

  copySheets(wb: Workbook<SheetNames>) {
    _.forEach(this.worksheets, (sheet, key) => {
      const readFrom = wb.worksheets[key]
      if (!readFrom) return
      readFrom.usedRange().forEach((cell: xlsx.Cell) => {
        const writeCell = sheet.row(cell.rowNumber()).cell(cell.columnNumber())
        if (cell.formula()) writeCell.formula(cell.formula())
        else writeCell.value(cell.value() as any)
      })
    })
  }

  getCell(sheet: string, target: string) {
    return this.workbook.sheet(sheet).cell(target)
  }

  toBuf() {
    return this.workbook.outputAsync()
  }

  toFile(filepath: string) {
    return this.workbook.toFileAsync(filepath)
  }
}

const toFolder = (foldername: string) =>
  foldername && !foldername.endsWith('/') ? foldername + '/' : foldername

export class LocalStorage {
  private pathname: string
  constructor(pathname: string) {
    this.pathname = toFolder(pathname)
  }
}

export class CloudStorage {
  private storage = new Storage({
    keyFilename: path.join(__dirname, '../data/service_account.json')
  })
  private bucket: Bucket
  constructor(bucketName: string, private pathname: string = '') {
    this.bucket = this.storage.bucket(bucketName)
    this.pathname = toFolder(this.pathname)
  }

  listFiles = (pathname?: string) =>
    this.bucket.getFiles({ prefix: toFolder(pathname) || this.pathname })

  createWriteStream = (name: string, option?: CreateWriteStreamOptions) =>
    this.bucket.file(path.join(this.pathname, name)).createWriteStream(option)

  deleteFolder = (foldername: string) =>
    this.bucket.deleteFiles({ prefix: foldername })

  uploadFrom = (filepath: string, to: string) =>
    this.bucket.upload(filepath, {
      destination: path.join(this.pathname, to)
    })

  getFile = (name: string) => this.bucket.file(name)
  readFile = (name: string) =>
    this.bucket.file(path.join(this.pathname, name)).download()
  writeFile = (name: string, data: string | Buffer) => {
    const filename = path.join(this.pathname, name)
    return this.bucket
      .file(filename)
      .save(data, {
        gzip: true
      })
      .then(() => Promise.resolve(filename))
  }

  readExcel = async <SheetNames extends { [key: string]: string }>(
    name: string,
    sheetNames: SheetNames
  ) => Workbook.fromData((await this.readFile(name))[0], sheetNames)

  saveExcel = async <SheetNames extends { [key: string]: string }>(
    wb: Workbook<SheetNames>,
    name: string
  ) => this.writeFile(name, await wb.toBuf())
  // wb
  //   .toBuf()
  //   .then(buf => this.bucket.file(path.join('archive/', name)).save(buf))

  uploadImg(folder: string, url: string, isURL = true) {
    const uuid = uuidv5(url, isURL ? uuidv5.URL : uuidv5.DNS)
    if (!url) return EMPTY

    return from(
      axios.get(url, {
        responseType: 'arraybuffer',
        httpsAgent,
        headers: { 'user-agent': userAgent }
      })
    ).pipe(
      tap(res => {
        console.log(url)
      }),
      map(res => Buffer.from(res.data)),
      concatMap(buf => Jimp.read(buf)),
      filter(image => !!image),
      map(image => image.autocrop()),
      concatMap(image => {
        const type = mime.lookup(url)

        return type
          ? from(image.getBufferAsync(type)).pipe(
              concatMap((buf: Buffer) =>
                this.writeFile(
                  path.join(folder, uuid + '.' + image.getExtension()),
                  buf
                )
              ),
              mapTo(uuid + '.' + image.getExtension())
            )
          : throwError('invalid type')
      })
    )
  }
}
