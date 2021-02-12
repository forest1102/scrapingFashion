import * as fs from 'fs-extra'
import readline from 'readline-promise'
import { drive_v3, google, sheets_v4 } from 'googleapis'
import * as path from 'path'
import { OAuth2Client, JWT } from 'google-auth-library'
import * as moment from 'moment'
import * as _ from 'lodash'
import { Storage } from '@google-cloud/storage'
import { v5 as uuidv5 } from 'uuid'
import { from, MonoTypeOperatorFunction, EMPTY } from 'rxjs'
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
import { retryWithDelay } from '../src_arc/monti/src/operators'
import * as Jimp from 'jimp'
import { Workbook } from 'exceljs'

// If modifying these scopes, delete token.json.

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
  private static readonly CREDENTIAL_PATH = path.join(
    __dirname,
    '../data/credentials.json'
  )
  private static readonly TOKEN_PATH = path.join(
    __dirname,
    '../data/token.json'
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

export class Drive {
  private folderId = ''
  constructor(folderId: string) {
    this.folderId = folderId
  }
  async getFileId(filename: string, folderId?: string) {
    const drive = await Auth.instance.fetchDrive()
    const { data } = await drive.files.list({
      q: `'${
        folderId || this.folderId
      }' in parents and trashed = false and name = '${filename}'`,
      fields: 'files/id'
    })
    if (!data || !data.files || data.files.length === 0)
      throw Error(filename + ' not found')
    return data.files[0].id
  }
}

export default class SpreadSheet<T extends { [key: string]: string }> {
  private spreadsheetId = ''
  private title = ''
  private data: RawData<T> = {}
  private count = 0
  private bufLen: number
  private sheetNames: T
  private auth = Auth.instance
  private sheetIds: { [x in keyof T]?: number } = {}
  constructor(spreadsheetId: string, bufLen: number, sheetNames: T) {
    this.spreadsheetId = spreadsheetId
    this.title = moment().format('MMDDHHmm')
    this.bufLen = bufLen
    this.sheetNames = sheetNames
  }

  async init() {
    await this.getSheetIdByNames()
    await this.clearAllCells()
  }

  addSheet() {
    return this.auth.fetchSheets().then(sheets => {
      return this.spreadsheetId
        ? sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [
                {
                  addSheet: {
                    properties: {
                      title: this.title
                    }
                  }
                }
              ]
            }
          })
        : Promise.reject('Unable to get spreadSheet')
    })
  }

  private appendSheet(data: RawData<T>) {
    if (!data || data === {}) return Promise.resolve(null)
    const requests = this.toRequest(data)

    if (requests.length === 0) return Promise.resolve(null)

    return this.auth.fetchSheets().then(sheets => {
      return this.spreadsheetId
        ? sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests
            }
          })
        : Promise.reject('Unable to get spreadSheet')
    })
  }

  private clearAllCells() {
    return Auth.instance.fetchSheets().then(sheets =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: _.reduce(
            this.sheetIds,
            (acc, cur) => [
              ...acc,
              {
                updateCells: {
                  range: {
                    sheetId: cur
                  },
                  fields: 'userEnteredValue'
                }
              }
            ],
            [] as sheets_v4.Schema$Request[]
          )
        }
      })
    )
  }
  private async getSheetIdByNames() {
    const sheets = await this.auth.fetchSheets()
    const sheetProps = await sheets.spreadsheets.get({
      spreadsheetId: this.spreadsheetId,
      fields: 'sheets.properties.sheetId,sheets.properties.title'
    })
    const ids = _.reduce(
      sheetProps.data.sheets,
      (acc, cur) => ({
        ...acc,
        [cur.properties.title]: cur.properties.sheetId
      }),
      {} as { [key: string]: number }
    )
    console.log(ids)

    for (const key of Object.keys(this.sheetNames)) {
      if (this.sheetNames[key] in ids) {
        this.sheetIds[key as keyof T] = ids[this.sheetNames[key]]
      } else {
        const {
          data: { replies }
        } = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: this.sheetNames[key],
                    gridProperties: {
                      columnCount: 104
                    }
                  }
                }
              }
            ]
          }
        })

        this.sheetIds[key as keyof T] = replies[0].addSheet.properties.sheetId
      }
    }
    console.log(this.sheetIds)

    return this.sheetIds
  }

  toRequest(raw: RawData<T>) {
    return _.flatMap(raw, (rows, key) => [
      {
        appendCells: {
          sheetId: this.sheetIds[key],
          rows: rows.map(
            cur =>
              ({
                values: [...cur].map(v => {
                  if (_.isNil(v) || v === '') return { formattedValue: '' }
                  if (_.isNumber(v))
                    return { userEnteredValue: { numberValue: v } }
                  if (_.isString(v))
                    return { userEnteredValue: { stringValue: v } }
                  if (v instanceof Object && 'formula' in v)
                    return v.formula
                      ? {
                          userEnteredValue: {
                            formulaValue:
                              (v.formula[0] === '=' ? '' : '=') + v.formula
                          }
                        }
                      : { formattedValue: '' }
                  else return { userEnteredValue: { stringValue: String(v) } }
                })
              } as sheets_v4.Schema$RowData)
          ),
          fields: 'userEnteredValue'
        }
      },
      {
        updateDimensionProperties: {
          properties: {
            pixelSize: 21
          },
          range: {
            sheetId: this.sheetIds[key],
            dimension: 'ROWS',
            startIndex: this.count - 1,
            endIndex: this.count + raw[key].length
          },
          fields: '*'
        }
      }
    ]) as sheets_v4.Schema$Request[]
  }

  async save(row: RawRow<T>) {
    this.data =
      this.data && row
        ? _.mergeWith(this.data, row, (obj, src) =>
            _.isArray(obj) ? [...obj, src] : [src]
          )
        : this.data

    if (this.count === 0) {
      await this.init()
    }

    ++this.count
    if (this.count % this.bufLen === 0) {
      await this.appendSheet(this.data)
      this.data = {}
    }
    return Promise.resolve()
  }

  async saveImage(path: string) {
    const drive = await this.auth.fetchDrive()
  }

  end() {
    return this.appendSheet(this.data).then(() => {
      this.data = {}
      this.count = 0
    })
  }
}

export async function newSpreadSheet(
  title: string,
  bufLen: number,
  sheetNames: string[]
) {
  const sheets = await Auth.instance.fetchSheets()
  const {
    data: { spreadsheetId }
  } = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title
      }
    },
    fields: 'spreadsheetId'
  })
}

export class CloudStorage {
  private storage = new Storage({
    keyFilename: path.join(__dirname, '../data/service_account.json')
  })
  private bucket = this.storage.bucket('scraping-datafiles')
  constructor(private pathname: string) {}

  readFile = (name: string) =>
    this.bucket.file(path.join(this.pathname, name)).download()
  writeFile = (name: string, data: string | Buffer) =>
    this.bucket
      .file(path.join(this.pathname, name))
      .save(data)
      .then(() => path.join(this.pathname, name))

  saveExcel = (wb: Workbook) =>
    wb.xlsx.writeBuffer().then(buf => this.writeFile('data.xlsx', buf as any))

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
      retryWithDelay(2000, 3) as MonoTypeOperatorFunction<AxiosResponse<any>>,
      filter(res => !!res.data),
      map(res => Buffer.from(res.data)),
      mergeMap(buf => Jimp.read(buf).catch(() => null)),
      filter((image: Jimp) => image !== undefined),
      map(image => image.autocrop()),
      mergeMap(image =>
        from(image.getBufferAsync(`image/${image.getExtension()}`)).pipe(
          mergeMap(buf =>
            this.writeFile(
              path.join(folder, uuid + '.' + image.getExtension()),
              buf
            )
          )
        )
      )
    )
  }
}
