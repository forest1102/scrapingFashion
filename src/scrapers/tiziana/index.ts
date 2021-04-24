import { getElementObj } from '../../observable'
import { from, of } from 'rxjs'
import { RxFetch, submitLoginForm } from '../../fetch'
import {
  map,
  tap,
  concatMap,
  filter,
  find,
  catchError,
  mapTo
} from 'rxjs/operators'
import * as _ from 'lodash'

import * as client from 'cheerio-httpcli'

import {
  findByWords,
  filterByWords,
  swapElement,
  sizeCompare
} from '../../util'
import { Scraper } from '../../scraperType'
import List from '../../lists'
export default class Tiziana extends Scraper {
  BASE_URL = 'https://www.tizianafausti.com/en/'
  NEXT_SELECTOR = '.pages-item-next a'
  sessID: string

  constructor(isItaly: boolean, lists: List, argv: any[]) {
    super(isItaly, lists, argv)
    this.sessID = _.last(argv)
    this.sessID = this.sessID === 'italy' ? '' : this.sessID
  }

  beforeFetchPages = (url: string) => {
    const verifyLogin = () =>
      RxFetch(
        'https://www.tizianafausti.com/r1_en/customer/account/index/'
      ).pipe(
        map($ =>
          $('.box-content')
            .first()
            .text()
        ),
        tap(info => console.log(info ? 'Success Login' : 'Failed Login'))
      )

    if (process.argv && process.argv.length === 4) {
      client.set('headers', {
        Cookie: 'PHPSESSID=' + this.sessID
      })

      return verifyLogin()
    } else {
      return of(url)
    }
  }

  toItemPageUrlObservable = ($: client.CheerioStaticEx, url: string) =>
    from($('li.product-item').toArray()).pipe(
      filter(el => !$('.stock.unavailable', el).length),
      map(el =>
        of({
          url: $('a', el)
            .first()
            .attr('href'),
          others: { gender: /-man$/.test(url) ? 'MEN' : 'WOMEN' }
        })
      )
    )

  extractData($: client.CheerioStaticEx, { gender }: { gender: string }) {
    let unit = ''
    const isVip = /\/vip3_en\//.test($.documentInfo().url)
    return of(
      getElementObj($, {
        brand: [
          '.product-brand',
          e =>
            e
              .first()
              .text()
              .trim()
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
        productName: [
          '[itemprop="name"]',
          e =>
            e
              .first()
              .text()
              .trim()
              .replace(/[`"']/g, '')
              .toUpperCase()
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
        price: ['meta[itemprop="price"]', e => e.attr('content')],
        old_price: [
          'span[data-price-type="oldPrice"]',
          e => e.attr('data-price-amount')
        ],
        size: isVip
          ? [
              '.product-options-wrapper .item-info',
              e =>
                e
                  .toArray()
                  .filter(el =>
                    _.thru(
                      $('td.qty:nth-child(2)', el).text(),
                      str => str && !str.includes('Out of Stock')
                    )
                  )
                  .map(el =>
                    $('.attr-label', el)
                      .text()
                      .trim()
                  )
            ]
          : [
              '.product-options-wrapper [type="text/x-magento-init"]',
              e =>
                (_.chain(JSON.parse(e.text() || '{}')).get(
                  [
                    '[data-role=swatch-options]',
                    'Magento_Swatches/js/configurable-customer-data',
                    'swatchOptions',
                    'attributes',
                    '307',
                    'options'
                  ],
                  []
                ) as _.CollectionChain<{ products: string[]; label: string }>)
                  .filter(v => v.products && v.products.length > 0)
                  .map(v => v.label || '')
                  .value()
            ],
        season: ['.product-season', e => (e.text() || '').trim()],
        sku: ['[itemprop="sku"]', e => e.text().trim()],
        description: [
          '.attribute.overview, .attribute.description',
          e => ({
            text: e.text(),
            li: e
              .find('li')
              .toArray()
              .map(el => '・' + $(el).text())
              .join('\r\n')
          })
        ],
        fit: [
          '.product.info.detailed .content',
          e =>
            _.chain(e.toArray())
              .map(el => $(el).text())
              .map(str => str.replace(/\s{2,}/g, ''))
              .join('\n')
              .value()
        ],
        image: [
          '#gallery_images img',
          e => e.toArray().map(el => el.attribs['src'] || '')
        ],
        category_tree: [
          'li[class*="category"]',
          e =>
            _.chain(e.toArray())
              .map(el => ($(el).text() || '').trim())
              .value()
        ],
        color: [
          '.attribute li',
          e =>
            _.chain(e.toArray())
              .map(el => $(el).text())
              .find(str => _.includes(str, 'colour'))
              .toUpper()
              .replace(/colour\s|\s{2,}/gi, '')
              .split(' / ')
              .take(1)
              .value()
        ]
      })
    ).pipe(
      map(obj => ({
        ...obj,
        gender: gender
      })),
      map(obj => ({
        ...obj,
        brand_sex: obj.brand + (obj.gender === 'MEN' ? ' M' : ''),
        size: _.thru(
          obj.size
            .map(s => s.replace(/[½+]/, '.5').replace(/ - .+/i, ''))
            .sort(sizeCompare),
          arr => (arr && arr.length > 0 ? arr : ['UNI'])
        ),
        currency: 'JPY',
        image: _.includes(obj.category_tree, 'Shoes')
          ? swapElement(obj.image, 0, 1)
          : obj.image
      })),
      map(obj => {
        const size_infos: string[] = []
        const descText = obj.description.text

        let tmp: RegExpMatchArray
        let country = ''
        let size_chart = ''

        if ((tmp = descText.match(/(?<=wedge )[0-9,.cm ]+/)))
          size_infos.push(tmp[0])

        if ((tmp = descText.match(/(cm|mm) (\d+x\d+x\d+)/)))
          size_infos.push(tmp[2] + tmp[1])

        if ((tmp = descText.match(/made in (\w+)/i))) {
          country = tmp[1]
          size_infos.push(tmp[0])
        }

        if (obj.fit) {
          if (
            (tmp = obj.fit.match(
              /Model wears size\s{0,2}(?:(\D+)|(\d+)\s(\w+))\./i
            ))
          ) {
            size_infos.push('Model wears size ' + (tmp[1] || tmp[2]))
            size_chart =
              tmp[1] && /[xsml]/i.test(tmp[1]) ? 'STANDARD' : tmp[3] || ''
          }

          if (
            (tmp = obj.fit.match(
              /Model measurements: shoulder ([0-9 .cm]+), chest ([0-9 .cm]+), waist ([0-9 .cm]+), hips ([0-9 .cm]+), height ([0-9 .cm]+)/i
            ))
          )
            size_infos.push(tmp[0])

          size_chart =
            _.get(this.lists.AHsize, [
              obj.brand_sex.toUpperCase(),
              _.includes(obj.category_tree, 'Shoes') ? 'shoes' : 'not shoes'
            ]) || size_chart

          if (!size_chart && (tmp = obj.fit.match(/(\w+)\ssizing/i))) {
            size_chart = tmp[1].trim()
          }

          size_chart +=
            size_chart && _.includes(obj.category_tree, 'Shoes') ? ' SHOES' : ''
          size_chart += size_chart ? ' ' + obj.gender : ''

          size_chart = !size_chart && obj.size[0] === 'UNI' ? 'UNI' : size_chart
          size_chart = !size_chart ? '指定なし' : size_chart
        } else {
          size_chart = '指定なし'
        }

        return {
          ...obj,
          size_info: size_infos.join('\r\n'),
          size_chart,
          country
        }
      }),
      map(obj => ({
        ...obj,
        category: _.thru(
          findByWords(this.lists.categories, obj.productName),
          category => (category ? `${obj.gender} ${category}` : '')
        ),
        description: obj.description.li,
        category_tree: obj.category_tree.join('-'),
        fit: obj.fit || '指定なし'
      })),
      concatMap(obj => {
        if (!this.isItaly) return of(obj)
        const id = _.nth(
          $.documentInfo().url.match(/\d+(?=(-uni)?\.html$)/i),
          0
        )
        if (!id) return of(obj)
        return RxFetch(
          $.documentInfo().url.replace(/\/(jp_en|vip3_en)\//, '/it_it/'),
          {},
          'utf8',
          false
        ).pipe(
          catchError(err => of(err.$ as client.CheerioStaticEx)),
          map($$ => ({
            ...obj,
            euro_price:
              $$ &&
              ((el =>
                el
                  .find('.normal-price, .old-price')
                  .find('.price-wrapper')
                  .attr('data-price-amount') ||
                el
                  .find('.price-final_price')
                  .find('.price-wrapper')
                  .attr('data-price-amount'))(
                $$(`[data-product-sku*="${id}"]`)
              ) ||
                $$('span[data-price-type="oldPrice"]').attr(
                  'data-price-amount'
                ) ||
                $$('meta[itemprop="price"]').attr('content'))
          }))
        )
      })
    )
  }
}
