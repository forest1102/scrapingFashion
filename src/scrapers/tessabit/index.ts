import { getElementObj, getAllPagesRx } from '../../observable'
import { from, of } from 'rxjs'
import {
  map,
  tap,
  concatMap,
  retry,
  reduce,
  startWith,
  flatMap,
  filter,
  bufferCount
} from 'rxjs/operators'

import {
  commaToDot,
  getSurfaceText,
  findByWords,
  filterByWords,
  sizeCompare
} from '../../util'

import { CheerioStaticEx } from 'cheerio-httpcli'
import * as _ from 'lodash'
import { Scraper } from '../../scraperType'

export default class extends Scraper {
  BASE_URL = 'https://www.tessabit.com/'
  NEXT_SELECTOR = 'a.next_jump'

  beforeFetchPages = (url: string) => of(url)

  toItemPageUrlObservable = ($: CheerioStatic) =>
    from($('.product-box.item').toArray()).pipe(
      filter(el => !/sold out/i.test($(el).text())),
      map(el =>
        of({
          url: $('a.product-image', el).first().attr('href'),
          others: {}
        })
      )
    )

  extractData = ($: CheerioStaticEx) => {
    let unit = ''
    const gender = /woman/.test($.documentInfo().url) ? 'WOMEN' : 'MEN'
    return of(
      getElementObj($, {
        brand: [
          '.brand-link span.brand-name',
          e =>
            _.chain(e.first().text())
              .trim()
              .replace(/`|'|"/g, '')
              .deburr()
              .upperCase()
              .value()
        ],
        productName: [
          '.product-name',
          e =>
            _.chain(e.first().text())
              .trim()
              .replace(/[`"']/g, '')
              .replace(/`|'|"/g, '')
              .deburr()
              .upperCase()
              .value()
        ],
        price: [
          '.regular-price .price,.special-price .price',
          e =>
            e
              .first()
              .text()
              .trim()
              .replace(/(EUR|\s+|[¥€.,])/g, '')
        ],
        old_price: [
          '.old-price .price',
          e =>
            e
              .text()
              .trim()
              .replace(/(EUR|\s+|[¥€.,])/g, '')
        ],
        size: [
          '#product-options-wrapper > script',
          e => {
            const text = e.text()
            if (!text) return ['UNI']

            const regMatch = text.match(/(?<=Config\().+(?=\))/)
            if (!regMatch || !regMatch[0]) return ['UNI']

            const config = JSON.parse(regMatch[0]) as {
              attributes: {
                '132': { options: { id: string; label: string }[] }
              }
              outOfStockSizeIds: string[]
            }

            if (!config) return ['UNI']

            return config.attributes['132'].options
              .filter(({ id }) => config.outOfStockSizeIds.indexOf(id) === -1)
              .map(({ label }) => label.replace(/[½+]/, '.5'))
              .sort(sizeCompare)
          }
        ],
        size_chart: [
          '.size-selector span.color-gray',
          e => e.first().text().toUpperCase()
        ],
        // sku: [
        //   '[itemprop="name"]',
        //   e => e.text().trim()
        // ],
        description: ['.description', e => getSurfaceText(e).trim() || ''],
        image: [
          '.item .product-image',
          e => e.toArray().map(el => el.attribs['href'] || '')
        ],
        country: [
          '#details-section',
          e => _.nth(e.text().match(/Made In\s+(\w+)/i), 1)
        ]
      })
    ).pipe(
      map(elem => {
        const category = findByWords(this.lists.categories, elem.productName)

        return {
          ...elem,
          category: category ? `${gender} ${category}` : '',
          color: filterByWords(
            this.lists.colorMap,
            elem.description.toLowerCase()
          ).map(v => v.toUpperCase()),
          brand_sex: elem.brand + (gender === 'MEN' ? ' M' : ''),
          currency: '€',
          fit: '指定なし',
          gender,
          size_info: ''
        }
      }),
      map(({ size_chart, ...others }) => {
        size_chart +=
          size_chart && findByWords(this.lists.shoes, others.productName)
            ? ' SHOES'
            : ''
        size_chart += size_chart && gender ? ' ' + gender : ''

        return {
          size_chart,
          ...others
        }
      }),
      map(obj => ({
        ...obj,
        season: _.nth(obj.image[0].match(/(?<=\/)\w+(?=-{3})/), 0),
        sku: _.nth(obj.image[0].match(/(?<=-{3})\w+?(?=(-\w+)?(_\d_\w)?\.)/), 0)
      }))
    )
  }
}
