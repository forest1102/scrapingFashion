import { getElementObj, getAllPagesRx } from '../../observable'
import { from, of } from 'rxjs'
import {
  map,
  tap,
  concatMap,
  retry,
  reduce,
  toArray,
  flatMap,
  filter
} from 'rxjs/operators'
import * as client from 'cheerio-httpcli'

import { addBaseURL, filterByWords } from '../../util'
import * as _ from 'lodash'

import { Scraper } from '../../scraperType'

client.set('headers', {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.109 Safari/537.36',
  'Cookie': 'TassoCambio=' + 'IsoTassoCambio=EUR'
})
export default class extends Scraper {
  NEXT_SELECTOR = '.pager a.next'

  beforeFetchPages = (url: string) => of(url)

  getAllCatalogPages = (url: string) => {
    return getAllPagesRx(url, this.NEXT_SELECTOR)
  }

  toItemPageUrlObservable = ($: client.CheerioStaticEx, url: string) =>
    from($('.product').toArray()).pipe(
      // filter(el => !($(el).find('.sold-out').length > 0)),
      map(el => of($('a.link', el).attr('href')))
    )

  extractData = ($: client.CheerioStaticEx, {}: { gender: string }) =>
    of(
      getElementObj($, {
        gender: ['title', e => e.first().text().trim().split(' ')[0]],
        brand: [
          '#details > h1 > a',
          e =>
            e
              .first()
              .text()
              .trim()
              .replace(/`|'/g, '')
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
        productName: [
          '#details h2',
          e => e.first().text().trim().replace(/`|'/g, '')
        ],
        // script: [
        //   '.data-sheet li:nth-child(1)',
        //   e => (e.first().text() || '').replace('SKU: ','').trim()
        // ],
        price: [
          '.price span[itemprop="price"]',
          e =>
            (e.attr('content').match(/[0-9,.]+/) || [''])[0].replace(
              /[,|.]00/,
              ''
            )
        ],

        old_price: [
          '.price .old',
          e =>
            ((e.first().text() || '').match(/[0-9,.]+/) || [''])[0]
              .replace(',00', '')
              .replace('.', ',')
        ],
        size: [
          '.sizes .list label',
          e =>
            e
              .toArray()
              .map(el =>
                $(el)
                  .text()
                  .trim()
                  .replace(/(\d+)[+½]/, '$1.5')
              )
              .filter(str => !/uni/i.test(str))
        ],
        description: ['div.detail', e => e.first().html()],
        image: [
          '.slick img',
          e => e.toArray().map(el => el.attribs['data-zoom-image'] || '')
        ]
        // currency:[
        //   'span[itemprop="priceCurrency"]',
        //   e=>e.attr('content')
        // ]
      })
    ).pipe(
      map(obj => ({
        ...obj,
        currency: '€',
        category: _.last($.documentInfo().url.match(/(?<=\/)[^\/]+?(?=\/)/gi))
      })),
      map(({ description, size, gender, category, ...others }) => ({
        ...others,
        description,
        gender,
        season: '',
        size: size.map(str => str.replace(/.+? (.+?)/, '$1')),
        size_chart: size[0] ? (size[0].match(/(.+?) .+?/) || [])[1] : '',
        sku: (description.match(/(?<=Product code: ).*(?=\s?<br>)/i) || [''])[0]
          .trim()
          .toUpperCase(),
        color: filterByWords(this.lists.colorMap, description),
        category: gender + ' ' + category,
        size_info: (() => {
          const heelHeight = description.match(/(?<=heel: )[0-9,.cminh ]+/i)
          if (heelHeight) return 'ヒール： ' + heelHeight[0]

          const sizeStr = description.match(/(?<=Dimension: )[0-9,.cminhx ]+/i)

          if (sizeStr) return sizeStr[0]

          return ''
        })()
      }))
    )
}
