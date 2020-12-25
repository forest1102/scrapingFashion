import { getElementObj, getAllPagesRx } from './observable'
import { from } from 'rxjs'
import { RxFetch, uploadImg } from './fetch'
import { map, tap, concatMap, retry, reduce, toArray, flatMap, filter } from 'rxjs/operators'
import { colors } from './colors'
import * as client from 'cheerio-httpcli'

import * as moment from 'moment'

import * as fs from 'fs-extra'
import * as path from 'path'

import { toArrIndex } from './lists'
import { commaToDot, addBaseURL, execAll } from './util'

const start = moment()
const dataStream = fs.createWriteStream(path.join(__dirname, '../data/data.csv'), 'utf8')
const BASE_URL = 'https://www.wiseboutique.com/en/'
const toUrl = addBaseURL(BASE_URL)
from(fs.readJSON(path.join(__dirname, '../data/urls.json')))
  .pipe(
    flatMap(arr => arr as string[]),
    concatMap(url =>
      getAllPagesRx(url, '.pagine:nth-last-child(2) div.nolink', (selector) => selector.attr('idref'))
        .pipe(
          // toArray(),
          // flatMap(v => v),
          tap(_ => client.set('headers', {
            'Cookie': `impostazioni=idnazione=28&nazione=Japan&lingua=en&settore=${(url.match(/woman|man/) || [''])[0].toUpperCase()}&&n=${(url.match(/\?n=([0-9a-zA-Z]+)(?=$|&)/) || ['', ''])[1]}&valuta=%E2%82%AC&spedizione=30;`
          })),
          tap(_ => console.log(client.headers)),
          concatMap($ =>
            from($('.cotienifoto').toArray())
              .pipe(
                filter(el => !($(el).find('.sold-out').length > 0)),
                map(el => ({
                  url: $('a', el).first().attr('href'),
                })),
                concatMap(({ url: _url }) =>
                  RxFetch(toUrl(_url))
                    .pipe(
                      map($$ => ({ $: $$ })),
                  )
                ),
                retry(10),
            ),
          ),
          filter(({ $ }) => !/sold out/i.test($('.clear.prezzo.textcenter').text())),
          map(({ $ }) => {
            let unit = ''
            return {
              ...getElementObj($, {
                'category': [
                  'span[itemprop="title"]',
                  (e) => e.toArray()
                    .slice(1)
                    .map(el => $(el).text().trim())
                    .join(' ')
                ],
                'brand': [
                  'span[itemprop="brand"]',
                  e =>
                    e
                      .first().text().trim()
                      .replace(/`|'|"/g, '')
                      .replace(/[àâä]/g, 'a')
                      .replace(/[ÀÂÄ]/g, 'A')
                      .replace(/[éèêë]/g, 'e')
                      .replace(/[ÉÈÊË]/g, 'e')
                      .replace(/[îï]/g, 'i')
                      .replace(/[ÎÏ]/g, 'I')
                      .replace(/[ôö]/g, 'o')
                      .replace(/[ÔÖ]/g, 'O')
                      .replace(/[ùûü]/g, 'u')
                      .replace(/[ÙÛÜ]/g, 'U')
                      .replace(/[ÿ]/g, 'y')
                      .replace(/[Ÿ]/g, 'Y')
                      .toUpperCase()
                ],
                'productName': [
                  '.textcenter[itemprop="description"]',
                  e => e.first().text().trim().replace(/[`"']/g, '').toUpperCase()
                    .replace(/`|'|"/g, '')
                    .replace(/[àâä]/g, 'a')
                    .replace(/[ÀÂÄ]/g, 'A')
                    .replace(/[éèêë]/g, 'e')
                    .replace(/[ÉÈÊË]/g, 'e')
                    .replace(/[îï]/g, 'i')
                    .replace(/[ÎÏ]/g, 'I')
                    .replace(/[ôö]/g, 'o')
                    .replace(/[ÔÖ]/g, 'O')
                    .replace(/[ùûü]/g, 'u')
                    .replace(/[ÙÛÜ]/g, 'U')
                    .replace(/[ÿ]/g, 'y')
                    .replace(/[Ÿ]/g, 'Y')
                ],
                sku: [
                  'ol.breadcrumb li:nth-last-child(1)',
                  e => e.first().text().trim()
                ],
                price: [
                  '[itemprop="price"]',
                  e =>
                    e
                      .first()
                      .first()
                      .text()
                      .replace(/[.€]|\s+/g, '')
                      .replace(',', '.')
                ],
                old_price: [
                  '.saldi',
                  e =>
                    e
                      .first()
                      .text()
                      .replace(/[.€]|\s+/g, '')
                      .replace(',', '.')
                ],
                'size': [
                  '.taglia',
                  e => e
                    .toArray()
                    .map(el => $(el).text().replace(/[½+]/g, '.5'))
                    .filter(size => size !== "TU")
                    .join(',')
                ],
                color: [
                  '.col9.last',
                  e => {
                    const colorName = e.last().text().trim().toLowerCase()
                    return (colors.findIndex(c => c.includes(colorName)) !== -1) ? colorName : ''
                  }
                ],
                description: [
                  '.col9.last .paddingtre',
                  e =>
                    e.toArray()
                      .map(el => $(el).html().replace(/<\/?(span|strong).*?>/g, '').split(/<\/?br>/))
                      .reduce((acc, cur) => [
                        ...acc,
                        ...cur
                      ], [])
                ],
                image: [
                  '.dettagli img',
                  e =>
                    e.toArray()
                      .map(el => toUrl(el.attribs['src']).replace('thumbs_', ''))
                ],
                season: [
                  '.dettagli a',
                  e =>
                    ((e
                      .first()
                      .attr('href') || '')
                      .match(/thumbs_(\w+)---/i) || [''])[1]
                ]
              }) as { image: string[], description: string[], fit: string },
              'currency': '€',
              'update': moment().format('YYYY/M/D HH:mm:ss'),
              'URL': $.documentInfo().url,
            }
          }),
          concatMap(({ image, ...others }) =>
            from(image)
              .pipe(
                concatMap(img => uploadImg(toUrl(img))),
                reduce((acc, val: string, i) => ({
                  [`img${i + 1}`]: image[i],
                  [`imgfile${i + 1}`]: val,
                  ...acc
                }), others)
              )
          ),
          map(({ description, ...others }) => ({
            ...others,
            description,
            size_chart: description.find(desc => /(US|IT|FR|JP|EU) size/.test(desc)),
            size_info: (() => {
              return description
                .filter(desc =>
                  /(Shoulders|Chest|Sleeves|Total|Heel|Length|Height|Depth|Handle): ([0-9., cminx"]+)/i.test(desc)
                  || /The model is [0-9]+ ?["inchm]+/i.test(desc)
                  || /Model height is [0-9]+ ?["inchm]+/i.test(desc)
                  || /(Model|he) is wearing a size \w+/i.test(desc))
                .join('\r\n')
            })()
          })),
          tap(x => console.log(x)),
          map(obj =>
            Object.keys(toArrIndex)
              .reduce((acc, cur) => ({
                [cur]: (obj[toArrIndex[cur]] || ''),
                ...acc
              }), {} as { [key: number]: string })
          ),
          map(obj =>
            Object.keys(obj)
              .reduce((acc, cur) => {
                acc[cur] = `"${obj[cur]}"`
                return acc
              }, []).join(',')
          ),
          tap(v => dataStream.write(v + '\n'))
        )
    )
  )
  .subscribe(
    v => { },
    err => console.error(err),
    () => console.log('Completed!', `time: ${moment.utc(moment().diff(start)).format('DD HH:mm:ss')}`)
  )
