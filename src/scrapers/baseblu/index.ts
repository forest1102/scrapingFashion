import { getElementObj, getAllPagesRx } from '../../observable'
import { from, of } from 'rxjs'
import { map } from 'rxjs/operators'

import * as client from 'cheerio-httpcli'
import * as _ from 'lodash'
import { Scraper } from '../../scraperType'

export default class extends Scraper {
  NEXT_SELECTOR = 'a[rel="next"]:not(.disabled)'
  beforeFetchPages = url => of(url)
  toItemPageUrlObservable = ($: client.CheerioStaticEx, url: string) =>
    from($('.thumbnail-container').toArray()).pipe(
      // filter(el => !($(el).find('.sold-out').length > 0)),
      map(el =>
        of({
          url: $('.product-title  a', el).attr('href'),
          others: { gender: url.includes('/woman/') ? 'WOMEN' : 'MEN' }
        })
      )
    )
  extractData = (
    $: client.CheerioStaticEx,
    { gender }: { [key: string]: any }
  ) =>
    of(
      getElementObj($, {
        category: [
          '#productLeft > nav > ol',
          e => {
            const textLi = e
              .first()
              .children('li')
              .toArray()
              .map(el => $(el).text().trim().toUpperCase().split(' '))

            const indexOfSale = textLi.findIndex(
              strArr => strArr.indexOf('Sale') !== -1
            )

            if (indexOfSale === -1) {
              return [
                textLi[1][0],
                textLi[2][0],
                _.last(_.last(textLi) as string[])
              ].join(' ')
            } else {
              return (
                textLi[indexOfSale - 1] +
                ' ' +
                textLi[indexOfSale + 1] +
                ' ' +
                textLi[textLi.length - 1]
              )
            }
          }
        ],
        brand: [
          '.product-manufacturer',
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
          '.product-name',
          e => e.first().text().trim().replace(/`|'/g, '')
        ],
        // script: [
        //   '.data-sheet li:nth-child(1)',
        //   e => (e.first().text() || '').replace('SKU: ','').trim()
        // ],
        old_price: [
          '.product-prices .regular-price',
          e => (e.text().match(/[0-9,.]+/) || [''])[0].replace(',', '')
        ],
        price: [
          '.current-price span',
          e => {
            const str = e.first().attr('content')
            return str
          }
        ],

        size: [
          '#group_1 option',
          e =>
            e
              .toArray()
              .map(el =>
                $(el)
                  .text()
                  .trim()
                  .replace(/(\d+)\+/, '$1.5')
              )
              .filter(str => !/uni/i.test(str))
        ],
        description: [
          '.product-features',
          e => e.first().text().trim().toLowerCase()
        ],
        image: [
          '.images-container img.thumb',
          e => e.toArray().map(el => el.attribs['data-image-large-src'] || '')
        ]
      })
    ).pipe(
      map(obj => ({ ...obj, currency: '¥' })),
      map(({ description, ...others }) => ({
        ...others,
        gender,
        euro_price: '0',
        description: '',
        sku: (description.match(/(?<=SKU: ).*/i) || [''])[0]
          .trim()
          .toUpperCase(),
        color: (description.match(/(?<=Color: ).*/i) || [''])[0]
          .trim()
          .toUpperCase()
          .split('/'),
        size_chart: (description.match(/(?<=Size Chart: ).*/i) || [''])[0]
          .trim()
          .toUpperCase(),
        season: (description.match(/(?<=season: ).*/i) || [''])[0].trim(),
        size_info: (() => {
          const heelHeight = description.match(
            /(?:heel height: ([0-9,. cm]+))|(?:Height: ([0-9,. cm]+)- HEEL HEIGHT)\n/i
          )
          if (heelHeight)
            return (
              'ヒール： ' +
              (heelHeight[1] || heelHeight[2]).trim().replace(',', '.')
            )

          const sizeReg = /(Height|Width|Depth): [0-9,. cm]+/gi

          let sizeArr = []
          let sizeStr = ''

          while (
            (sizeArr = sizeReg.exec(description)) !== null &&
            sizeArr[1] &&
            sizeArr[2]
          ) {
            switch (sizeArr[1]) {
              case 'height':
                sizeStr += '高さ： ' + sizeArr[2].replace(',', '.')
                break
              case 'width':
                sizeStr += '幅： ' + sizeArr[2].replace(',', '.')
                break
              case 'depth':
                sizeStr += 'マチ： ' + sizeArr[2].replace(',', '.')
            }
          }
          return sizeStr
        })()
      }))
    )
}
