import { from, of, throwError, EMPTY } from 'rxjs'
import { RxFetch } from '../fetch'
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

import { Parser as FormulaParser } from 'hot-formula-parser'
import * as micromatch from 'micromatch'

import {
  addBaseURL,
  makeRegId,
  ObjectToArray,
  setBackground,
  getBytes,
  replaceWords,
  makeRingItr
} from '../util'

// import value from './typing'
import * as urlPath from 'url'
import { Scraper } from '../scraperType'
import List from '../lists'
import { CloudStorage, Workbook } from '../saver'
import { isNil, isNumber, isObject, isString, omit } from 'lodash'
import * as path from 'path'
import { filter } from 'rxjs/operators'

export const execScrape = async (
  argv: string[],
  onData?: (count: number) => Promise<any>
) => {
  let count = 0
  let saveTo = ''
  let finish: (err?: Error) => Promise<unknown>
  try {
    const start = moment()
    if (argv.length < 4) {
      console.log('設定が不十分です')
      throw Error()
    }
    const scraperName = argv[2]
    const ScraperModule = require(`./${scraperName}`).default
    const DATA_PATH = argv[3]
    const DATA_PREFIX =
      DATA_PATH.replace(/\//g, '_') + ' ' + moment().format('YYYY-MM-DD HH mm')
    const isItaly = argv[4] === 'italy'
    const readFrom = new CloudStorage('scraping-datafiles', DATA_PATH)
    saveTo = DATA_PREFIX
    const writeTo = new CloudStorage('scraping-archives', DATA_PREFIX)
    const list = new List(readFrom)
    await list.loadFiles()
    const scraper: Scraper = new ScraperModule(
      isItaly,
      list,
      argv && argv.slice(3)
    )

    const workbook = await Workbook.fromBlank({
      processed_data: '変換後',
      data: 'data',
      output_data: '出品用data'
    })
    const workbookMacro = await readFrom.readExcel('putupbuyma-0.60.xlsm', {
      processed_data: '変換後',
      data: 'data',
      output_data: 'Sheet2'
    })
    const saveExcels = () => {
      return writeTo
        .saveExcel(workbook, DATA_PREFIX + ' data.xlsx')
        .then(() =>
          writeTo.saveExcel(
            workbookMacro,
            DATA_PREFIX + ' putupbuyma-0.60.xlsm'
          )
        )
    }
    finish = (err?: Error) => {
      const I2Cell = workbookMacro.getCell('Sheet1', 'I2')
      I2Cell.value(
        path.win32.join(
          list.constants.フォルダ ?? I2Cell.value(),
          saveTo,
          'img'
        )
      )
      return saveExcels()
    }

    // const workbook = new Excel.Workbook()
    // const sheet = {
    //   processed_data: workbook.addWorksheet('変換後'),
    //   data: workbook.addWorksheet('data'),
    //   output_data: workbook.addWorksheet('出品用data')
    // }
    const getNextBrand = list.makeBrandItr()
    const getNextCatch = makeRingItr(list.catchWords)
    const getNextMark = makeRingItr(list.marks)
    const getNextRegId = makeRegId(list.constants['管理番号'])
    const converter = await list.getConverter()
    const priceMasterConverter = await list.priceMasterConverterAsync()
    await from(await list.getUrlsAsync())
      .pipe(
        concatMap(url =>
          scraper.beforeFetchPages(url).pipe(
            // toArray(),
            // flatMap(v => v),
            concatMap(() => scraper.getAllPages(url)),
            concatMap($ => scraper.toItemPageUrlObservable($, url)),
            concatMap(obs =>
              obs.pipe(
                concatMap(data =>
                  typeof data === 'string'
                    ? RxFetch(urlPath.resolve(url, data)).pipe(
                        map($$ => ({ $: $$, others: { isItaly } }))
                      )
                    : typeof data === 'object' && 'url' in data
                    ? RxFetch(urlPath.resolve(url, data.url)).pipe(
                        map($$ => ({
                          $: $$,
                          others: Object.assign(data.others || {}, {
                            isItaly
                          })
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
                    })),
                    concatMap(({ image, ...others }) =>
                      from(image).pipe(
                        filter(img => !!img),
                        concatMap(img =>
                          writeTo.uploadImg(
                            'img',
                            urlPath.resolve(others.URL, img)
                          )
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
            )
          )
        ),
        concatMap(async obj => {
          return {
            ...obj,
            ...(priceMasterConverter[obj.brand_sex] || priceMasterConverter[''])
          }
        }),
        concatMap(async obj => {
          return {
            ...obj,
            ...(converter.seasonConverter[obj.season] ||
              converter.seasonConverter['']),
            ...(converter.categoryConverter[obj.category] || {
              big_category: '',
              small_category: obj.category_tree,
              tag: ''
            }),

            brand_pro: converter.brandConverter[obj.brand],
            brand_name: getNextBrand(obj.brand_sex),
            color_pro: obj.color.map(
              c =>
                converter.colorConverter
                  .filter(p => !!p.before)
                  .find(p => micromatch.isMatch(c, p.before))?.['before'] || c
            ),
            brand_temp_pro:
              converter.brandTemplateConverter[obj.brand_sex] || '',
            size_pro:
              obj.size_chart in converter.sizeConverter
                ? obj.size.map(
                    s =>
                      converter.sizeConverter[obj.size_chart][s] ||
                      (s.lastIndexOf('/指定なし') === -1 ? s + '/指定なし' : s)
                  )
                : obj.size.map(s =>
                    s.lastIndexOf('/指定なし') === -1 ? s + '/指定なし' : s
                  ),
            sup: converter.supConverter[obj.season],
            title: replaceWords(obj.productName, converter.titleConverter)
          }
        }),
        map(obj => ({
          ...obj,

          shipping: list.constants['発送手段'],
          buy_lim: list.constants['購入期限'],
          auction: list.constants['出品'],
          shop_id: list.constants['買付地'],
          deliver_id: list.constants['発送地'],
          amount: list.constants['数量'],
          payment: list.constants['※購入者の支払方法'],
          theme: list.constants['テーマ'],
          supplier: list.constants['買付先ショップ名'],
          tariff: list.constants['関税'],

          gender:
            obj.gender === 'MEN'
              ? 'メンズファッション'
              : 'レディースファッション',

          catch_word: getNextCatch.next().value,
          mark: getNextMark.next().value,
          reg_id: getNextRegId.next().value
        })),
        map((obj, i) => ({
          ...obj,
          title_pro: {
            f: `CS${i + 2}&CV${i + 2}&CU${i + 2}&CT${i + 2}&CQ${i + 2}`
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
            f: obj.price_target_formula.replace(/_/g, '' + (i + 2))
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
            f: `SUBSTITUTE(CR${i + 2},"XXX",CQ${i +
              2}) & CHAR(10) & CHAR(10) &AG${i +
              2}& CHAR(10) & CHAR(10) &AK${i + 2}& CHAR(10) & CHAR(10) &M${i +
              2}& CHAR(10) & CHAR(10) &AB${i + 2}& CHAR(10) & CHAR(10) &P${i +
              2}`
          },
          euro_price: obj.euro_price || {
            f:
              obj.duty !== null
                ? obj.duty.replace(/_/g, String(i + 2))
                : obj.duty
          }
        })),
        map((obj, i) => ({
          ...obj,
          price_ref: {
            f: obj.price_ref_formula.replace(/_/g, '' + (i + 2))
          },
          price_pro: {
            f: obj.price_pro_formula.replace(/_/g, '' + (i + 2))
          },

          word_count_val: getBytes(obj.title_pro_val),
          word_count: {
            f: `LENB(E${i + 2})`,
            v: getBytes(obj.title_pro_val)
          },
          discount:
            obj.show_discount || !obj.old_price || obj.old_price === obj.price
              ? obj.discount
              : 0
        })),
        map(obj => {
          const parser = new FormulaParser()
          const getVal = (cell: number | string | { f: string }) => {
            if (!cell) return 0
            if (isObject(cell) && 'f' in cell)
              return (cell.f && parser.parse(cell.f).result) || 0

            return cell
          }
          parser.setVariable('AW_', obj.discount || 0)
          parser.setVariable('AX_', obj.set_val)
          parser.setVariable('AY_', obj.postage)
          parser.setVariable('BC_', obj.exchange_rate)
          parser.setVariable('AT_', getVal(obj.price))
          parser.setVariable('AE_', getVal(obj.old_price))
          parser.setVariable('AV_', getVal(obj.euro_price))

          const { result: price_ref_val, error } = parser.parse(
            obj.price_ref_formula
          )
          if (error) console.log(error)

          const { result: price_target_val } = parser.parse(
            obj.price_target_formula
          )

          parser.setVariable('AU_', price_target_val)

          const { result: price_pro_val } = parser.parse(obj.price_pro_formula)

          return {
            ...obj,
            price_ref_val,
            price_pro_val
          }
        }),

        // tap(x => console.log(x)),
        map(obj => ({
          data: ObjectToArray(List.toArrIndex, obj),
          processed_data: ObjectToArray(List.toProcessedIndex, obj),
          output_data: ObjectToArray(
            List.toOutputIndex,
            obj.price_ref_val < obj.price_pro_val
              ? omit(obj, ['price_ref', 'payment'])
              : obj
          )
        })),
        startWith({
          data: list.headers,
          processed_data: list.headers,
          output_data: list.headers
        }),
        concatMap(v => {
          const lastRow = workbook.appendRow(v)
          const lastRowMacro = workbookMacro.appendRow(v)
          ++count
          console.log('row: ', count)

          if (lastRow.processed_data.cell('CX').value() >= 60) {
            setBackground(lastRow.processed_data, ['CX', 'E'], 'FFFF00')
            setBackground(lastRow.output_data, ['CX', 'E'], 'FFFF00')
          }
          if (lastRowMacro.processed_data.cell('CX').value() >= 60) {
            setBackground(lastRowMacro.processed_data, ['CX', 'E'], 'FFFF00')
            setBackground(lastRowMacro.output_data, ['CX', 'E'], 'FFFF00')
          }
          return onData(count)
        }),
        concatMap(() =>
          count % 200 === 0
            ? saveExcels().then(() => 'Saved!')
            : Promise.resolve('Next')
        )
      )
      .toPromise()

    await finish().catch(err => console.log(err))
    return { count, saveTo, err: null }
    // spreadSheet
    //   .end()
  } catch (e) {
    console.error(e)
    await (finish && finish(e))
    return { count, saveTo, err: e }
  }
}
