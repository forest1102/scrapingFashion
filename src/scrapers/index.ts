import { from, of, throwError, EMPTY, Observable, Subscription } from 'rxjs'
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
import * as _ from 'lodash'
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

export const execScrape = (
  argv: any[],
  after: (count: number, err?: Error) => Promise<any>
) => {
  const start = moment()
  if (argv.length < 4) {
    console.log('設定が不十分です')
    process.exit(1)
  }
  let subsc: Subscription
  let save = (err?: Error): Promise<any> => Promise.resolve()
  const scraperName = argv[2]
  const ScraperModule = require(`./${scraperName}`).default
  const DATA_PATH = argv[3]
  const isItaly = argv[4] === 'italy'
  const storage = new CloudStorage(
    DATA_PATH,
    'archive/' +
      DATA_PATH.replace(/\//g, '_') +
      moment().format(' YYYY-MM-DD HH:mm:ss') +
      '.zip',
    err => {
      subsc.unsubscribe()
      save(err).catch(err => console.log(err))
    }
  )
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
  ;(['SIGINT', 'SIGTERM'] as NodeJS.Signals[]).forEach(sig => {
    process.on(sig, () => {
      console.log('interrupt ', sig)
      subsc.unsubscribe()

      save()
        .then(name => {
          console.log('Saved')
          process.exit()
        })
        .catch(err => {
          console.log('error while saving: ', err)
          process.exit()
        })
      // process.exit()
    })
  })

  const list = new List(storage)
  list
    .loadFiles()
    .then(async () => {
      const LINE_HEIGHT = 15

      const scraper: Scraper = new ScraperModule(
        isItaly,
        list,
        _.slice(argv, 3)
      )

      const workbook = await Workbook.fromBlank({
        processed_data: '変換後',
        data: 'data',
        output_data: '出品用data'
      })
      const workbookMacro = await storage.readExcel('putupbuyma-0.60.xlsm', {
        processed_data: '変換後',
        data: 'data',
        output_data: 'Sheet2'
      })
      let count = 0
      save = (err?: Error) =>
        Promise.all([
          storage.saveExcel(workbook, 'data.xlsx'),
          storage.saveExcel(workbookMacro, 'putupbuyma-0.60.xlsm'),
          storage.upload(),
          after(count, err)
        ])

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
      subsc = from(list.urls)
        .pipe(
          concatMap(url =>
            scraper.beforeFetchPages(url).pipe(
              // toArray(),
              // flatMap(v => v),
              concatMap(() => scraper.getAllPages(url)),
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
                      }))
                    )
                  ),
                  concatMap(({ image, ...others }) =>
                    from(image).pipe(
                      concatMap(img =>
                        img
                          ? storage.uploadImg(
                              'img',
                              urlPath.resolve(others.URL, img)
                            )
                          : EMPTY
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

            ...(list.seasonConverter[obj.season] || list.seasonConverter['']),
            ...(list.categoryConverter[obj.category] || {
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
              f: `SUBSTITUTE(CR${i + 2},"XXX",CQ${
                i + 2
              }) & CHAR(10) & CHAR(10) &AG${i + 2}& CHAR(10) & CHAR(10) &AK${
                i + 2
              }& CHAR(10) & CHAR(10) &M${i + 2}& CHAR(10) & CHAR(10) &AB${
                i + 2
              }& CHAR(10) & CHAR(10) &P${i + 2}`
            },
            euro_price: obj.euro_price || {
              f: _.isString(obj.duty)
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
              obj.old_price && obj.old_price !== obj.price ? 0 : obj.discount
          })),
          map(obj => {
            const parser = new FormulaParser()
            parser.setVariable('AT_', +obj.price)
            parser.setVariable('AW_', obj.discount || 0)
            parser.setVariable('AX_', obj.set_val)
            parser.setVariable('AY_', obj.postage)
            parser.setVariable('BC_', obj.exchange_rate)

            const price_ref_val = parser.parse(obj.price_ref_formula)
              .result as number

            const price_target_val = parser.parse(obj.price_target_formula)
              .result as number

            parser.setVariable('AU_', price_target_val)

            const price_pro_val = parser.parse(obj.price_pro_formula)
              .result as number

            return {
              ...obj,
              price_ref_val,
              price_pro_val
            }
          }),
          tap(x => console.log(x)),
          map(obj => ({
            data: ObjectToArray(List.toArrIndex, obj),
            processed_data: ObjectToArray(List.toProcessedIndex, obj),
            output_data: ObjectToArray(
              List.toOutputIndex,
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
            const lastRow = workbook.appendRow(v)
            const lastRowMacro = workbookMacro.appendRow(v)
            ++count

            if (lastRow.processed_data.cell('CX').value() >= 60) {
              setBackground(lastRow.processed_data, ['CX', 'E'], 'FFFF00')
              setBackground(lastRow.output_data, ['CX', 'E'], 'FFFF00')
            }
            if (lastRowMacro.processed_data.cell('CX').value() >= 60) {
              setBackground(lastRowMacro.processed_data, ['CX', 'E'], 'FFFF00')
              setBackground(lastRowMacro.output_data, ['CX', 'E'], 'FFFF00')
            }
            // if (lastRow.processed.getCell('CX').result >= 60) {
            // }

            // spreadSheet.save(v).catch(err => console.error(err))
          },
          e => {
            console.error(e)
            save(e)
              // spreadSheet
              //   .end()
              .then(() => console.log('Saved!'))
              .catch(err => console.log('error while saving: ', err))
          },
          () => {
            console.log('Finished!\n')
            save()
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
      // if (process.platform === 'win32') {
      //   const rl = require('readline').createInterface({
      //     input: process.stdin,
      //     output: process.stdout
      //   })

      //   rl.on('SIGINT', function () {
      //     //@ts-ignore
      //     process.emit('SIGINT')
      //   })
      // }

      // process.stdin.resume()

      console.log(client.headers)
    })
    .catch(err => {
      return after(0, err)
    })
}
