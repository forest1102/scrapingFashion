import { getElementObj, getAllPagesRx } from './observable'
import { from, of, throwError, EMPTY, Observable } from 'rxjs'
import { RxFetch, uploadImg } from './fetch'
import {
  map,
  tap,
  concatMap,
  reduce,
  startWith,
  flatMap,
  toArray,
  catchError,
  delay
} from 'rxjs/operators'
import * as client from 'cheerio-httpcli'

import * as moment from 'moment'

import * as fs from 'fs-extra'
import * as path from 'path'

import * as Excel from 'exceljs'
import { Parser as FormulaParser } from 'hot-formula-parser'
import * as _ from 'lodash'
import * as micromatch from 'micromatch'

import * as list from './lists'
const { categoryConverter } = list
import {
  addBaseURL,
  makeBrandItr,
  makeRingItr,
  makeRegId,
  ObjectToArray,
  setBackground,
  getBytes,
  replaceWords
} from './util'

// import value from './typing'
import * as urlPath from 'url'
import { randomDelay } from './operators'
import SpreadSheet from './saver'
import { Scraper } from './scraperType'

const constants = require('../data/constants.json')

const start = moment()

const LINE_HEIGHT = 15

const scraperName = process.argv[2]
if (!scraperName || scraperName === 'italy') {
  console.log('スクレイピング 先を入力してください')
  process.exit(1)
}
const ScraperModule = require(path.join(__dirname, `./scrapers/${scraperName}`))
  .default
const scraper: Scraper = new ScraperModule(process.argv)
const isItaly = process.argv[3] === 'italy'
if (!scraper) {
  console.log('不明なスクレイピング 先です')
  process.exit(1)
}
const EXCEL_PATH = path.join(__dirname, `../data/${scraperName}/data.xlsx`)
const DATA_PATH = path.join(__dirname, `../data/${scraperName}/urls.json`)

// const spreadSheet = new SpreadSheet(scraper.spreadsheetId, 10, scraper.sheetIds)

let _tmp$sigint_listener: NodeJS.SignalsListener
const sigintListeners = process.listeners('SIGINT')
for (const listener of sigintListeners) {
  if (listener.name === '_tmp$sigint_listener') {
    // this is the unique name of the listener function
    _tmp$sigint_listener = listener // extract and save for later
    process.removeListener('SIGINT', listener)
    break
  }
}

const workbook = new Excel.Workbook()
const sheet = {
  processed_data: workbook.addWorksheet('変換後'),
  data: workbook.addWorksheet('data'),
  output_data: workbook.addWorksheet('出品用data')
}

const getNextBrand = makeBrandItr()
const getNextCatch = makeRingItr(list.catchWords)
const getNextMark = makeRingItr(list.marks)
const getNextRegId = makeRegId(constants['管理番号'])

process.env.UV_THREADPOOL_SIZE = '128'
if (process.platform === 'win32') {
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.on('SIGINT', function () {
    //@ts-ignore
    process.emit('SIGINT')
  })
}

// process.stdin.resume()
process.on('SIGINT', () => {
  console.log('interrupt')

  workbook.xlsx
    .writeFile(EXCEL_PATH)
    .then(() => {
      console.log('Saved!')
      process.exit()
    })
    .catch(err => {
      console.log('error while saving: ', err)
      process.exit()
    })
  // spreadSheet
  //   .end()
  //   .then(() => {
  //     console.log('Saved!')
  //     process.exit()
  //   })
  //   .catch(err => {
  //     console.log('error while saving: ', err)
  //     process.exit()
  //   })
  // process.exit()
})

console.log(client.headers)
from(fs.readJSON(DATA_PATH))
  .pipe(
    flatMap(arr => arr as string[]),
    concatMap(url =>
      scraper.beforeFetchPages(url).pipe(
        // toArray(),
        // flatMap(v => v),
        concatMap(() => getAllPagesRx(url, scraper.NEXT_SELECTOR)),
        concatMap($ => scraper.toItemPageUrlObservable($, url)),
        concatMap(obs =>
          obs.pipe(
            toArray(),
            concatMap(arr => arr),
            concatMap(data =>
              _.isString(data)
                ? RxFetch(urlPath.resolve(url, data)).pipe(
                    map($$ => ({ $: $$, others: { isItaly } }))
                  )
                : _.isPlainObject(data) && 'url' in data
                ? RxFetch(urlPath.resolve(url, data.url)).pipe(
                    map($$ => ({
                      $: $$,
                      others: Object.assign(data.others || {}, { isItaly })
                    }))
                  )
                : EMPTY
            ),
            concatMap(({ $, others }, i) =>
              scraper.extractData($, { ...others, i }).pipe(
                map(data => ({
                  ...data,
                  update: moment().format('YYYY/M/D HH:mm:ss'),
                  URL: $.documentInfo().url,
                  brand_sex:
                    `${data.brand}` + (data.gender === 'MEN' ? ' M' : '')
                }))
              )
            ),
            concatMap(({ image, ...others }) =>
              from(image).pipe(
                concatMap(img =>
                  img ? uploadImg(urlPath.resolve(others.URL, img)) : EMPTY
                ),
                reduce(
                  (acc, val: string, i) => ({
                    [`img${i + 1}`]: image[i],
                    [`imgfile${i + 1}`]: val,
                    ...acc
                  }),
                  others
                )
              )
            )
          )
        )
      )
    ),
    map(obj => ({
      ...obj,

      shipping: constants['発送手段'] as string,
      buy_lim: constants['購入期限'] as string,
      auction: constants['出品'] as string,
      shop_id: constants['買付地'] as string,
      deliver_id: constants['発送地'] as string,
      amount: constants['数量'] as string,
      payment: constants['※購入者の支払方法'] as string,
      theme: constants['テーマ'] as string,
      supplier: constants['買付先ショップ名'] as string,
      tariff: constants['関税'] as string,

      gender:
        obj.gender === 'MEN' ? 'メンズファッション' : 'レディースファッション',

      ...(list.seasonConverter[obj.season] || list.seasonConverter['']),
      ...(categoryConverter[obj.category] || {
        big_category: '',
        small_category: obj.category_tree,
        tag: ''
      }),
      ...(list.priceMasterConverter[obj.brand_sex] ||
        list.priceMasterConverter['']),

      brand_pro: list.brandConverter[obj.brand],
      brand_name: getNextBrand(obj.brand_sex),
      color_pro: obj.color.map(c =>
        _.chain(list.colorConverter)
          .filter(p => !!p.before)
          .find(p => micromatch.isMatch(c, p.before))
          .get('after')
          .defaultTo(c)
          .value()
      ),
      brand_temp_pro: list.brandTemplateConverter[obj.brand_sex] || '',
      size_pro:
        obj.size_chart in list.sizeConverter
          ? obj.size.map(s =>
              _.defaultTo(
                list.sizeConverter[obj.size_chart][s],
                s.lastIndexOf('/指定なし') === -1 ? s + '/指定なし' : s
              )
            )
          : obj.size.map(s =>
              s.lastIndexOf('/指定なし') === -1 ? s + '/指定なし' : s
            ),
      sup: list.supConverter[obj.season],
      title: replaceWords(obj.productName, list.titleConverter),

      catch_word: getNextCatch.next().value,
      mark: getNextMark.next().value,
      reg_id: getNextRegId.next().value
    })),
    map((obj, i) => ({
      ...obj,
      title_pro: {
        formula: `CS${i + 2}&CV${i + 2}&CU${i + 2}&CT${i + 2}&CQ${i + 2}`
      },
      title_pro_val: [
        obj.brand_name,
        obj.mark,
        obj['season 2'],
        obj.catch_word,
        obj.title
      ]
        .filter(v => v)
        .join(''),
      price_target: {
        formula: obj.price_target_formula.replace(/_/g, '' + (i + 2))
      },
      comment_val: [
        obj.brand_temp_pro.replace('XXX', obj.title),
        obj.size_info,
        obj.sku,
        obj.sup,
        obj.reg_id
      ]
        .filter(s => s)
        .join('\n\n'),
      comment: {
        formula: `SUBSTITUTE(CR${i + 2},"XXX",CQ${
          i + 2
        }) & CHAR(10) & CHAR(10) &AG${i + 2}& CHAR(10) & CHAR(10) &AK${
          i + 2
        }& CHAR(10) & CHAR(10) &M${i + 2}& CHAR(10) & CHAR(10) &AB${
          i + 2
        }& CHAR(10) & CHAR(10) &P${i + 2}`
      },
      euro_price: obj.euro_price || {
        formula: _.isString(obj.duty)
          ? obj.duty.replace(/_/g, String(i + 2))
          : obj.duty
      }
    })),
    map((obj, i) => ({
      ...obj,
      price_ref: { formula: obj.price_ref_formula.replace(/_/g, '' + (i + 2)) },
      price_pro: { formula: obj.price_pro_formula.replace(/_/g, '' + (i + 2)) },

      word_count_val: getBytes(obj.title_pro_val),
      word_count: {
        formula: `LENB(E${i + 2})`,
        result: getBytes(obj.title_pro_val)
      },
      discount: obj.old_price && obj.old_price !== obj.price ? 0 : obj.discount
    })),
    map(obj => {
      const parser = new FormulaParser()
      parser.setVariable('AT_', +obj.price)
      parser.setVariable('AW_', obj.discount || 0)
      parser.setVariable('AX_', obj.set_val)
      parser.setVariable('AY_', obj.postage)
      parser.setVariable('BC_', obj.exchange_rate)

      const price_ref_val = parser.parse(obj.price_ref_formula).result as number

      const price_target_val = parser.parse(obj.price_target_formula)
        .result as number

      parser.setVariable('AU_', price_target_val)

      const price_pro_val = parser.parse(obj.price_pro_formula).result as number

      return {
        ...obj,
        price_ref_val,
        price_pro_val
      }
    }),
    tap(x => console.log(x)),
    map(obj => ({
      data: ObjectToArray(list.toArrIndex, obj),
      processed_data: ObjectToArray(list.toProcessedIndex, obj),
      output_data: ObjectToArray(
        list.toOutputIndex,
        obj.price_ref_val < obj.price_pro_val
          ? _.omit(obj, ['price_ref', 'payment'])
          : obj
      )
    })),
    startWith({
      data: list.headers,
      processed_data: list.headers,
      output_data: list.headers
    })
  )
  .subscribe(
    v => {
      sheet.data.addRow(v.data).height = LINE_HEIGHT
      const lastRow = {
        processed: sheet.processed_data.addRow(v.processed_data),
        output: sheet.output_data.addRow(v.output_data)
      }
      lastRow.processed.height = LINE_HEIGHT
      lastRow.output.height = LINE_HEIGHT

      if (lastRow.processed.getCell('CX').result >= 60) {
        setBackground(lastRow.processed, ['CX', 'E'], 'FFFF00')
        setBackground(lastRow.output, ['CX', 'E'], 'FFFF00')
      }

      // spreadSheet.save(v)
    },
    e => {
      console.error(e)
      workbook.xlsx
        .writeFile(EXCEL_PATH)
        // spreadSheet
        //   .end()
        .then(() => console.log('Saved!'))
        .catch(err => console.log('error while saving: ', err))
    },
    () => {
      workbook.xlsx
        .writeFile(EXCEL_PATH)
        // spreadSheet
        //   .end()
        .then(() => console.log('Saved!'))
        .catch(err => console.log('error while saving: ', err))
      console.log(
        'Completed!',
        `time: ${moment().diff(start, 'minutes')} minutes`
      )
    }
  )
