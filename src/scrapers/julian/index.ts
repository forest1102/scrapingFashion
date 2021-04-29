import { getElementObj, getAllPagesRx } from '../../observable'
import { from, of } from 'rxjs'
import { map, filter, tap, mapTo, concatMap } from 'rxjs/operators'
import { findByWords, filterByWords, updateCookie } from '../../util'

import * as _ from 'lodash'
import { getAuthCredential, RxFetch } from '../../fetch'
import { Scraper } from '../../scraperType'
import { CheerioStaticEx } from 'cheerio-httpcli'

export default class extends Scraper {
  NEXT_SELECTOR = 'a.next'

  beforeFetchPages = (url: string) => {
    this.client.set('headers', {
      Cookie: 'TassoCambio=IsoTassoCambio=EUR;'
    })
    console.log(this.client.headers)
    return getAuthCredential(
      'https://www.julian-fashion.com/en-JP/User/Login',
      {
        login_email: 'hedirockmode@gmail.com',
        login_password: 'rock1226'
      },
      { headers: { Referer: url } }
    ).pipe(
      tap(cookie => {
        this.client.set('headers', {
          Cookie: updateCookie(cookie, 'TassoCambio', 'IsoTassoCambio=EUR')
        })
      }),
      mapTo(url)
    )
  }

  toItemPageUrlObservable = ($: CheerioStaticEx, url: string) =>
    from($('.product.in-stock').toArray()).pipe(
      map(el =>
        of({
          url: $(el)
            .children('a')
            .first()
            .attr('href'),
          others: {
            season: $('.tag', el)
              .first()
              .text()
              .trim(),
            gender: /\/women/.test(url) ? 'WOMEN' : 'MEN'
          }
        })
      )
    )

  extractData = (
    $: CheerioStaticEx,
    { season, gender }: { [key: string]: string }
  ) =>
    of(
      getElementObj($, {
        category_tree: [
          '.headline__breadcrumbs a.item',
          e =>
            e
              .toArray()
              .map(el =>
                $(el)
                  .text()
                  .toUpperCase()
              )
              .join('-')
        ],
        brand: [
          'h1[itemprop="brand"]',
          e =>
            _.chain(e.first().text())
              .deburr()
              .replace(/"/g, `'`)
              .replace(/[`']/g, '')
              .upperCase()
              .split(' ')
              .map(str => str[0].toUpperCase() + str.slice(1))
              .join(' ')
              .value()
        ],
        productName: [
          'h2.subtitle',
          e =>
            _.chain(e.first().text())
              .deburr()
              .trim()
              .replace(/"/g, `'`)
              .toUpper()
              .value()
        ],
        price: [
          'span[itemprop="price"]',
          e =>
            (e.first().attr('content') || '').replace(
              /(EUR|\s+|[¥€]|[.]00$|,)/g,
              ''
            )
        ],
        old_price: [
          'span[itemprop="price"] .old',
          e => (e.text() || '').replace(/(EUR|\s+|[¥€.]|[,]00$|,)/g, '')
        ],
        size: [
          '#size-selection option',
          e =>
            e
              .toArray()
              .slice(1)
              .map(el =>
                $(el)
                  .text()
                  .replace(/(\d+)(\+|½|,5)/, '$1.5')
                  .trim()
              )
        ],
        sku: ['span[itemprop="sku"]', e => e.attr('content')],
        description: [
          '#product-detail-description',
          e =>
            e
              .html()
              .trim()
              .replace(/<\/?br>/g, '\n')
              .replace(/<\/?\s*[^>]*>/gi, '')
              .replace(/ {2,}/g, '')
        ],
        image: [
          ' .product-detail__photos--desktop .slide img.image',
          e => e.toArray().map(el => el.attribs['data-src'] || '')
        ]
      })
    ).pipe(
      map(obj => ({
        ...obj,
        image:
          obj.image.length > 3 && obj.category_tree.includes('BAGS')
            ? [obj.image[obj.image.length - 1], ...obj.image.slice(0, -1)]
            : obj.image
      })),
      map(obj => {
        const category = _.defaultTo(
          findByWords(this.lists.categories, obj.productName),
          ''
        ).toUpperCase()
        return {
          ...obj,
          category: category ? gender + ' ' + category : category,
          currency: '€',
          season,
          gender
        }
      }),
      map(({ size, ...others }) => {
        if (!size.length || size[0] === 'U')
          return { ...others, size, size_chart: '指定なし' }
        if (/[xsml]/i.test(size[0]))
          return {
            ...others,
            size,
            size_chart: 'STANDARD ' + others.gender
          }
        const matches = size[0].match(/(\d+) (\w+)/)
        if (matches && matches[2])
          return {
            ...others,
            size: size.map(s => s.replace(/ \w+/, '')),
            size_chart: `${matches[2]} ${
              others.category && findByWords(this.lists.shoes, others.category)
                ? 'SHOES '
                : ''
            }${others.gender}`
          }
        return { ...others, size, size_chart: '指定なし' }
      }),
      map(({ description, ...others }) => ({
        ...others,
        description,
        color:
          filterByWords(this.lists.colorMap, description.toUpperCase()) || [],
        country: _.get(description.match(/Made in: (\w+)/), '1', ''),
        size_info: (() => {
          const fit = (description.match(/(?<=size&fit: ).*?(?=$)/i) || [])[0]
          if (!fit) return ''
          let result = []
          const reg = /(W|H|D) ([0-9inhcm ]+)/gi
          let match: RegExpExecArray
          if ((match = /(?<=heels )[0-9inhcm ]+/i.exec(fit))) {
            return 'ヒール ' + match[0]
          }

          while ((match = reg.exec(fit)) && match[1] && match[2]) {
            switch (match[1].toLowerCase()) {
              case 'w':
                result.push('横 ' + match[2].trim())
                break
              case 'h':
                result.push('縦 ' + match[2].trim())
                break
              case 'd':
                result.push('マチ ' + match[2].trim())
                break
            }
          }
          return result.join(' x ')
        })()
      })),
      map(obj => ({
        ...obj,
        description: _.flattenDeep([
          String(obj.price),
          obj.productName,
          obj.color,
          'ーーーーーーーーーーー',
          obj.description
        ]).join('\n')
      })),
      concatMap(obj => {
        if (!this.isItaly) return of(obj)
        return RxFetch(
          this.client,
          $.documentInfo().url.replace('en-JP', 'en-IT')
        ).pipe(
          map($$ => ({
            ...obj,
            euro_price: (
              $$('span[itemprop="price"] .old')
                .first()
                .text() ||
              $$('span[itemprop="price"]')
                .first()
                .attr('data-mktg-product-price') ||
              ''
            ).replace(/(EUR|\s+|[¥€.]|[,]00$|,)/g, '')
          }))
        )
      })
    )
}
