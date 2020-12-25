import * as fs from 'fs-extra'
import readline from 'readline-promise'
import { google, sheets_v4 } from 'googleapis'
import * as path from 'path'
import { OAuth2Client } from 'google-auth-library'
import * as moment from 'moment'
import * as _ from 'lodash'
import { reduce } from 'lodash'

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
const CREDENTIAL_PATH = path.join(__dirname, '../data/credentials.json')
const TOKEN_PATH = path.join(__dirname, '../data/token.json')

type RawRow<T> =
  | { [P in keyof T]: (string | number | { formula: string })[] }
  | {}
type RawData<T> =
  | { [P in keyof T]: (string | number | { formula: string })[][] }
  | {}

export default class SpreadSheet<T extends { [key: string]: number }> {
  private oAuth2Client: OAuth2Client = null
  private spreadsheetId = ''
  private title = ''
  private data: RawData<T> = {}
  private count = 0
  private bufLen: number
  private sheetIds: T
  constructor(spreadsheetId: string, bufLen: number, sheetIds: T) {
    this.spreadsheetId = spreadsheetId
    this.title = moment().format('MMDDHHmm')
    this.bufLen = bufLen
    this.sheetIds = sheetIds
  }

  private fetchOAuth2Client = () =>
    this.oAuth2Client
      ? Promise.resolve(this.oAuth2Client)
      : fs
          .readFile(CREDENTIAL_PATH)
          .then(content => {
            const credentials = JSON.parse(content.toString())
            const {
              client_secret,
              client_id,
              redirect_uris
            } = credentials.installed
            this.oAuth2Client = new google.auth.OAuth2(
              client_id,
              client_secret,
              redirect_uris[0]
            ) as any

            // Check if we have previously stored a token.
            return fs
              .readFile(TOKEN_PATH)
              .then(token =>
                this.oAuth2Client.setCredentials(JSON.parse(token.toString()))
              )
              .catch(err => this.getNewToken())
              .then(() => {
                return this.oAuth2Client
              })
          })
          .catch(err => {
            return Promise.reject('Error loading client secret file:' + err)
          })

  private getNewToken() {
    const authUrl = this.oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES
    })
    console.log('Authorize this app by visiting this url:', authUrl)
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true
    })

    return (rl.questionAsync(
      'Enter the code from that page here: '
    ) as Promise<string>).then(code => {
      rl.close()
      return this.oAuth2Client
        .getToken(code)
        .then(({ tokens }) => {
          this.oAuth2Client.setCredentials(tokens)
          // Store the token to disk for later program executions
          return fs.writeFile(TOKEN_PATH, JSON.stringify(tokens)).then(() => {
            console.log('Token stored to', TOKEN_PATH)
          })
        })
        .catch(err => 'Error while trying to retrieve access token' + err)
    })
  }

  private sheets: sheets_v4.Sheets = null

  private fetchSheets = () =>
    this.sheets
      ? Promise.resolve(this.sheets)
      : this.fetchOAuth2Client().then(() => {
          this.sheets = google.sheets({
            version: 'v4',
            auth: this.oAuth2Client as any
          })
          return this.sheets
        })

  addSheet() {
    return this.fetchSheets().then(res => {
      return this.spreadsheetId
        ? this.sheets.spreadsheets.batchUpdate({
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

    return this.fetchSheets().then(res => {
      return this.spreadsheetId
        ? this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests
            }
          })
        : Promise.reject('Unable to get spreadSheet')
    })
  }

  private clearAllCells() {
    return this.fetchSheets().then(() =>
      this.sheets.spreadsheets.batchUpdate({
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
            startIndex: this.count,
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
      await this.clearAllCells()
    }

    ++this.count
    if (this.count % this.bufLen === 0) {
      await this.appendSheet(this.data)
      this.data = {}
    }
    return Promise.resolve()
  }

  end() {
    return this.appendSheet(this.data).then(() => {
      this.data = {}
      this.count = 0
    })
  }
}
// const spreadsheetId = '10UvwDeVcbYCrTrh-N_dXgpa0iiIJLdPVVLShkiuvl4o'
// const sheetIds = {
//   data: 0
// }

// const spreadsheet = new SpreadSheet(spreadsheetId, 10, sheetIds)
// console.dir(
//   spreadsheet.toRequest({
//     data: [
//       [1, 2, 3],
//       [5, 6, '1'],
//       [{ formula: 'A1' }, 5, 6]
//     ]
//   }),
//   { depth: null }
// )
