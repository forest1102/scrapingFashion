import { getElementObj, getAllPagesRx } from '../../observable'
import { from, of } from 'rxjs'
import { RxFetch, getAuthCredential } from '../../fetch'

import {
  map,
  tap,
  concatMap,
  retry,
  reduce,
  toArray,
  flatMap,
  filter,
  mapTo
} from 'rxjs/operators'
import * as client from 'cheerio-httpcli'

import {
  addBaseURL,
  findByWords,
  filterByWords,
  updateCookie,
  sizeCompare,
  execIfNotEmpty,
  swapElement
} from '../../util'
import * as _ from 'lodash'
import { Scraper } from '../../scraperType'

console.log(client.headers)

export default class extends Scraper {
  BASE_URL = 'https://www.styleisnow.com'
  NEXT_SELECTOR = 'a.action.next'
  beforeFetchPages = (url: string) => {
    return RxFetch(
      'https://www.styleisnow.com/business/customer/account/login/'
    ).pipe(
      map($ => $('#login-form > input[name="form_key"]').attr('value')),
      concatMap(form_key =>
        getAuthCredential(
          'https://www.styleisnow.com/business/customer/account/loginPost/',
          {
            'login[username]': 'tmkhn03090801@gmail.com',
            'login[password]': 'Rock1226@',
            form_key,
            'persistent_remember_me': 'on'
          },
          { headers: { Cookie: `form_key=${form_key}` } }
        )
      ),
      tap(cookie => {
        client.set('headers', {
          Cookie: updateCookie(cookie, 'form_key', undefined)
        })
      }),
      mapTo(url)
    )
  }
  toItemPageUrlObservable = ($: client.CheerioStaticEx, url: string) =>
    from($('.products-grid .item').toArray()).pipe(
      filter(el => !/sold out/i.test($(el).text())),
      map(el =>
        of({
          url: $('a.product-item-link', el).attr('href'),
          others: {
            discount_percent: (($('.discount-percent', el).text() || '').match(
              /\d+%/
            ) || [''])[0]
          }
        })
      )
    )
  extractData = (
    $: client.CheerioStaticEx,
    { discount_percent }: { [key: string]: string }
  ) =>
    of(
      getElementObj($, {
        category_tree: [
          '.breadcrumbs a,.breadcrumbs strong',
          e => e.toArray().map(el => $(el).text().trim())
        ],
        brand: [
          '[itemprop="brand"]',
          e =>
            _(e.first().text())
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
              .split(' ')
              .map(word => word[0].toUpperCase() + word.slice(1))
              .join(' ')
        ],
        productName: [
          '[itemprop="caname"]',
          e =>
            e
              .first()
              .text()
              .trim()
              .replace(/`|'/g, '')
              .replace(/[àâä]/g, 'a')
              .replace(/[ÀÂÄ]/g, 'A')
              .replace(/[éèêë]/g, 'e')
              .replace(/[ÉÈÊË]/g, 'E')
              .replace(/[îï]/g, 'i')
              .replace(/[ÎÏ]/g, 'I')
              .replace(/[ôö]/g, 'o')
              .replace(/[ÔÖ]/g, 'O')
              .replace(/[ùûü]/g, 'u')
              .replace(/[ÙÛÜ]/g, 'U')
              .replace(/[ÿ]/g, 'y')
              .replace(/[Ÿ]/g, 'Y')
        ],
        sku: ['[itemprop="sku"]', e => e.first().text()],
        price: ['[itemprop="price"]', e => e.attr('content')],

        old_price: [
          '.old-price',
          e =>
            _.chain(e.text())
              .thru(str => (str ? str.match(/[0-9.,]+/) : undefined))
              .head()
              .replace(',', '')
              .value()
        ],
        size: [
          '#product-options-wrapper script[type="text/x-magento-init"]',
          e =>
            _.chain(
              JSON.parse(e.first().text() || '{}') as {
                [key: string]: { [key: string]: any }
              }
            )
              .get(
                '["#bss-ptd-table"]["bss/configurableproductwholesale"]["jsonChildInfo"]'
              )
              .map(info => (info.attribute || '').replace(',', '.'))
              .value()
        ],
        size_chart: [
          '[itemprop="tipo-taglia"]',
          e => (e.first().text() || '').replace(/size /i, '').trim()
        ],
        description: [
          '.description,.attribute.text',
          e =>
            e
              .toArray()
              .map(el =>
                $(el)
                  .text()
                  .toLowerCase()
                  .trim()
                  .replace(/\s{2,}/g, ' ')
              )
              .join('\n')
        ],
        color: [
          'div[itemprop="colore"]',
          e => (e.first().text() || '').trim().toUpperCase().split('/')
        ],
        image: [
          '.product.media script[type="text/x-magento-init"]',
          e =>
            (_.chain(JSON.parse(e.first().text()) as { [key: string]: {} })
              .get(
                '["[data-gallery-role=gallery-placeholder]"]["mage/gallery/gallery"][data]'
              )
              .map('full')
              .filter(v => !!v)
              .value() || []) as string[]
        ]
        // currency:[
        //   'span[itemprop="priceCurrency"]',
        //   e=>e.attr('content')
        // ]
      })
    ).pipe(
      map(obj => ({
        ...obj,
        currency: 'JPY',
        gender: _.includes(obj.category_tree, 'Men') ? 'MEN' : 'WOMEN',
        productName:
          obj.productName || _.toUpper(_.nth(obj.category_tree, -1)) || ''
      })),
      map(obj => ({
        ...obj,
        brand_sex: obj.brand + (obj.gender === 'MEN' ? ' M' : '')
      })),
      map(obj => ({
        ...obj,
        category_tree: obj.category_tree.join('-'),
        image: _.includes(obj.category_tree, 'Clothing')
          ? swapElement(obj.image, 0, 1)
          : obj.image,
        size_chart: _.chain(this.lists.AHsize)
          .get([
            obj.brand_sex.toUpperCase(),
            _.includes(obj.category_tree, 'Shoes') ? 'shoes' : 'not shoes'
          ])
          .thru(str => str || obj.size_chart)
          .thru(str =>
            str
              ? str +
                (_.includes(obj.category_tree, 'Shoes') ? ' SHOES' : '') +
                ' ' +
                obj.gender
              : '指定なし'
          )
          .value(),
        country: discount_percent
      })),
      map(({ description, ...others }) => ({
        ...others,
        category: _.thru(
          findByWords(this.lists.categories, others.productName),
          category => (category ? `${others.gender} ${category}` : '')
        ),
        description,
        season: execIfNotEmpty(
          (description.match(/(?<=season:\s?).*/) || [''])[0]
            .trim()
            .toUpperCase(),
          str =>
            (_.nth($.documentInfo().url.match(/\d{3}/), 0) || '') + ' ' + str
        ),
        size_info: (() => {
          const reg = /(Belt height|Heel|Length|Lenght|Height|Depth|Handle):\s?([0-9., cminx"]+)/gi
          let m: RegExpExecArray
          const result = []

          if ((m = /Model height is [0-9]+ ?["inchm]+/i.exec(description))) {
            result.push(m[0].trim())
          }

          if (
            (m = /(she|he) is wearing a size \w+( \d+)?/i.exec(description))
          ) {
            result.push(m[0].trim())
          }

          if ((m = /model wears size [0-9.,incm"]+/i.exec(description))) {
            result.push(m[0].trim())
          }

          while ((m = reg.exec(description)) && m.length > 2) {
            result.push(m[0].trim())
          }
          return result.join('\r\n')
        })()
      }))
    )
}
