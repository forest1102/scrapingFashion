import { getElementObj, getAllPagesRx, getAllPages } from '../../observable'
import { from, of } from 'rxjs'
import {
  RxFetch,
  fetchAndSaveCookies,
  userAgent,
  httpsAgent
} from '../../fetch'
import {
  map,
  tap,
  concatMap,
  retry,
  reduce,
  toArray,
  flatMap,
  filter,
  concatMapTo,
  catchError
} from 'rxjs/operators'
import * as client from 'cheerio-httpcli'

import {
  commaToDot,
  addBaseURL,
  execAll,
  findByWords,
  sizeCompare
} from '../../util'
import * as tough from 'tough-cookie'
import axios from 'axios'
import { Scraper } from '../../scraperType'
export default class extends Scraper {
  BASE_URL = ''

  NEXT_SELECTOR = 'a.next'
  beforeFetchPages = (url: string) => {
    const jar = new tough.CookieJar()
    const saveCookies = () =>
      new Promise((resolve, reject) => {
        jar.getCookieString(url, (err, cookieStr) => {
          if (!err) {
            client.set('headers', {
              Cookie: cookieStr
            })
            console.log(client.headers)
            return resolve(cookieStr)
          }
          reject(err)
        })
      })
    return from(
      axios.get(url, {
        jar,
        withCredentials: true,
        headers: { 'User-Agent': userAgent },
        httpsAgent: httpsAgent
      })
    ).pipe(
      map(saveCookies),
      catchError(() => {
        return from(saveCookies()).pipe(concatMapTo(of(url)))
      })
    )
  }

  getAllCatalogPages = (url: string) => {
    return getAllPagesRx(url, this.NEXT_SELECTOR)
  }

  toItemPageUrlObservable = ($: client.CheerioStaticEx, url: string) => {
    return from($('.product-item').toArray()).pipe(
      filter(el => !/sold out/i.test($('.product-price', el).text())),
      map(el =>
        of({
          url: $('a.product-item-photo', el).first().attr('href'),
          others: {
            gender: /\/women\//.test(
              $.documentInfo().url.replace('donna', 'women')
            )
              ? 'WOMEN'
              : 'MEN'
          }
        })
      )
    )
  }

  extractData = ($: client.CheerioStaticEx, { gender }: { gender: string }) =>
    of(
      getElementObj($, {
        brand: [
          '.product-title-name a span',
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
          'h1.page-title  p.title',
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
        sku: ['.product-code', e => e.first().text().trim()],
        price: [
          '.product-detail [data-price-type="finalPrice"]',
          e => e.first().attr('data-price-amount')
        ],
        old_price: [
          '.product-detail [data-price-type="oldPrice"]',
          e => e.first().attr('data-price-amount')
        ],
        size: [
          '#product-options-wrapper > div > script:nth-child(2)',
          e => {
            try {
              const obj: {} = JSON.parse(e.first().text())[
                '#product_addtocart_form'
              ].configurable.spConfig.attributes

              return Object.keys(obj)
                .map(key => obj[key].options as { label: string }[])
                .reduce((acc, cur) => [...acc, ...cur], [])
                .map(val => val.label)
                .map(val => val.replace(/[½+]/g, '.5'))
                .filter(label => !/sold out/i.test(label))
                .sort(sizeCompare)
            } catch {
              return []
            }
          }
        ],
        size_info: [
          'div.size-and-fit p',
          e =>
            e
              .toArray()
              .map(el => $(el).text().trim())
              .join('\r\n')
        ],
        image: [
          '.gallery_desktop script',
          e =>
            execAll(/"full":"(.+?)"/g, e.text())
              .map(arr => arr[1] || '')
              .map(str => str.replace(/\\/g, ''))
        ],
        color: [
          'h1.page-title  p.title',
          e =>
            this.lists.colors.filter(
              c => e.first().text().toLowerCase().indexOf(c) !== -1
            )
        ],
        season: ['td[data-th="Season"]', e => e.first().text()],
        country: [
          '.details',
          e => ((e.text() || '').match(/(?<=Made in ).+$/i) || [])[0]
        ],
        description: [
          '.product-info-detailed-description',
          e =>
            e
              .find('p')
              .toArray()
              .map(v => $(v).text())
              .join('\r\n')
        ]
      })
    ).pipe(
      map(obj => ({
        ...obj,
        gender,
        brand_sex: obj.brand + (gender === 'MEN' ? ' M' : '')
      })),
      map(obj => {
        if (obj.size[0] === 'TU') return { ...obj, size_chart: '指定なし' }
        if (/[xsml]/i.test(obj.size[0]))
          return { ...obj, size_chart: 'STANDARD ' + obj.gender }
        if (obj.brand_sex in this.lists.AHsize) {
          let size_chart = ''
          size_chart = findByWords(this.lists.shoes, obj.productName)
            ? this.lists.AHsize[obj.brand_sex]['shoes'] + ' SHOES'
            : this.lists.AHsize[obj.brand_sex]['not shoes']
          size_chart += size_chart ? ` ${obj.gender}` : ''
          return { ...obj, size_chart }
        }
        return {
          ...obj,
          size: obj.size.map(s => s + '/指定なし'),
          size_chart: '指定なし'
        }
      }),
      map(obj => {
        const category = findByWords(this.lists.categories, obj.productName)

        return { ...obj, category: category ? `${gender} ${category}` : '' }
      }),
      map(obj => ({
        ...obj,
        currency: /en_it/.test($.documentInfo().url) ? '€' : 'JPY'
      })),
      map(obj =>
        obj.old_price
          ? {
              ...obj,
              price: obj.old_price,
              old_price: obj.price
            }
          : obj
      )
    )
}
