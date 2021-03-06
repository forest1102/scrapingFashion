import { getElementObj } from '../../observable'
import { from, of } from 'rxjs'
import { map, tap } from 'rxjs/operators'

import * as client from 'cheerio-httpcli'

import { Scraper } from '../../scraperType'
import List from '../../lists'
import { fetchAndSaveCookies } from '../../fetch'
import {
  findByWords,
  filterByWords,
  swapElement,
  sizeCompare,
  execAllGen,
  deburr,
  thru,
  isEmpty
} from '../../util'

export default class extends Scraper {
  NEXT_SELECTOR = '.next'
  constructor(isItaly: boolean, lists: List, argv: any[]) {
    super(isItaly, lists, argv)
    client.set('headers', { Cookie: this.Cookie.jp })
  }
  beforeFetchPages = (url: string) =>
    fetchAndSaveCookies({
      url: 'https://www.ilduomo.it/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data:
        'email=hedirockmode%40gmail.com&password=rock1226&back=&submitLogin=1'
    }).pipe(
      tap(() => {
        console.log(client.headers)
      })
    )

  toItemPageUrlObservable = ($: CheerioStatic, url: string) =>
    from($('article.product-miniature').toArray()).pipe(
      // filter(el => !$('.stock.unavailable', el).length),
      map(el =>
        of({
          url: $('a.thumbnail', el)
            .first()
            .attr('href'),
          others: {}
        })
      )
    )
  Cookie = {
    it: 'delivery_country=IT; ',
    jp: 'delivery_country=JP; '
  }

  extractData = (
    $: client.CheerioStaticEx,
    others: { [key: string]: string }
  ) => {
    let unit = ''
    return of(
      getElementObj($, {
        brand: [
          '#productLeft .product-manufacturer',
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
          '#productLeft .product-name',
          e =>
            deburr(e.first().text())
              .replace(/[`"'*]|\s{2,}/g, '')
              .trim()
              .toUpperCase()
        ],
        price: [
          '#productLeft span[itemprop="price"]',
          e =>
            e
              .first()
              .text()
              .replace(/[,\s¥€$]/g, '')
        ],
        old_price: [
          '#productLeft .regular-price',
          e =>
            e
              .first()
              .text()
              .replace(/[,\s¥€$]/g, '')
        ],
        size: [
          '#productLeft .product-variants option',
          e =>
            e.toArray().map(el =>
              $(el)
                .text()
                .trim()
                .replace(',', '.')
            )
        ],
        features: [
          '#productLeft .product-features li',
          e =>
            e
              .toArray()
              .map(el => ($(el).text() || '').trim())
              .join('\r\n')
        ],
        description: ['#productLeft .product-description', e => e.text()],
        // fit: [
        //   '.product.info.detailed .content',
        //   e =>
        //     _.chain(e.toArray())
        //       .map(el => $(el).text())
        //       .map(str => str.replace(/\s{2,}/g, ''))
        //       .join('\n')
        //       .value()
        // ],
        image: [
          '#main .main-pr-image img',
          e => e.toArray().map(el => el.attribs['src'] || '')
        ],
        category_tree: [
          '#wrapper .breadcrumb span[itemprop="name"]',
          e =>
            e
              .toArray()
              ?.map(el => ($(el).text() || '').replace(/^\s*_|\s*$/, ''))
              .slice(1, -1)
        ],
        discount_percent: [
          '.discount-percentage',
          e => e.text()?.match(/\d+%/)?.[0] || ''
        ]
        // color: [
        //   '#main .color-value',
        //   e => e.toArray().map(el => $(el).text().trim().toUpperCase())
        // ]
      })
    ).pipe(
      map(obj => ({
        ...obj,
        // color: obj.color.filter(c => this.lists.colorMap[c]),
        euro_price: null,
        old_price: obj.old_price || obj.price,
        description: obj.description + '\r\n' + obj.features,
        gender: obj.features.includes('Gender: WOMAN') ? 'WOMEN' : 'MEN'
      })),
      map(obj => ({
        ...obj,
        old_price: this.lists.constants['レート']
          ? { f: obj.old_price + '/' + this.lists.constants['レート'] }
          : obj.old_price,
        price: this.lists.constants['レート']
          ? { f: obj.price + '/' + this.lists.constants['レート'] }
          : obj.price,
        brand_sex: obj.brand + (obj.gender === 'MEN' ? ' M' : ''),
        size: thru(
          obj.size
            .map(s => s.replace(/[½+]/, '.5').replace(/ - .+/i, ''))
            .sort(sizeCompare),
          arr => (arr && arr.length > 0 ? arr : ['UNI'])
        ),
        currency: '€'
        // image: _.includes(obj.category_tree, 'Shoes')
        //   ? swapElement(obj.image, 0, 1)
        //   : obj.image
      })),
      map(obj => {
        const size_infos: string[] = []
        const descText = obj.features

        let tmp: RegExpMatchArray
        let country = ''
        let season = ''
        let sku = ''
        let color = []
        // if ((tmp = descText.match(/(?<=wedge )[0-9,.cm ]+/)))
        //   size_infos.push(tmp[0])

        // if ((tmp = descText.match(/(cm|mm) (\d+x\d+x\d+)/)))
        //   size_infos.push(tmp[2] + tmp[1])
        if ((tmp = descText.match(/^Dimensions:(( +[DWH]:[0-9,.]+cm){3})/im))) {
          if (tmp[1]) size_infos.push('おおよそのサイズ:' + tmp[1])
        }

        if ((tmp = descText.match(/made in (\w+)/i))) {
          country = tmp[1]
          if (!isEmpty(size_infos)) size_infos.push(tmp[0])
        }

        if ((tmp = descText.match(/^season: (\w+)/im))) season = tmp[1]

        if ((tmp = descText.match(/^SKU: (.+)/im)))
          sku = tmp[1].replace(/[+&]/g, '')

        if ((tmp = descText.match(/^color: (.+)/im)))
          color = tmp[1]
            ?.split('/')
            ?.map(str => filterByWords(this.lists.colorMap, str))
            ?.reduce((acc, cur) => [...acc, ...cur], [] as string[])

        // if (obj.fit) {
        //   if (
        //     (tmp = obj.fit.match(
        //       /Model wears size\s{0,2}(?:(\D+)|(\d+)\s(\w+))\./i
        //     ))
        //   ) {
        //     size_infos.push('Model wears size ' + (tmp[1] || tmp[2]))
        //     size_chart =
        //       tmp[1] && /[xsml]/i.test(tmp[1]) ? 'STANDARD' : tmp[3] || ''
        //   }

        //   if (
        //     (tmp = obj.fit.match(
        //       /Model measurements: shoulder ([0-9 .cm]+), chest ([0-9 .cm]+), waist ([0-9 .cm]+), hips ([0-9 .cm]+), height ([0-9 .cm]+)/i
        //     ))
        //   )
        //     size_infos.push(tmp[0])

        //   // size_chart =
        //   //   _.get(this.lists.AHsize, [
        //   //     obj.brand_sex.toUpperCase(),
        //   //     _.includes(obj.category_tree, 'Shoes') ? 'shoes' : 'not shoes'
        //   //   ]) || size_chart

        //   if (!size_chart && (tmp = obj.fit.match(/(\w+)\ssizing/i))) {
        //     size_chart = tmp[1].trim()
        //   }

        //   size_chart =
        //     size_chart &&
        //     size_chart +
        //       (findByWords(this.lists.shoes, obj.productName) ? ' SHOES' : '') +
        //       (' ' + obj.gender)

        //   size_chart = !size_chart && obj.size[0] === 'UNI' ? 'UNI' : size_chart
        //   size_chart = !size_chart ? '指定なし' : size_chart
        // } else {
        //   size_chart = '指定なし'
        // }

        return {
          ...obj,
          size_info: size_infos.join('\r\n'),
          country,
          season,
          sku,
          color
        }
      }),
      map(obj => ({
        ...obj,
        country: obj.discount_percent,
        size_chart:
          thru(
            thru(
              this.lists.AHsize?.[obj.brand_sex.toUpperCase()],
              v =>
                v &&
                (obj.category_tree?.indexOf('shoes') !== -1
                  ? v['shoes'] && v['shoes'] + ' SHOES'
                  : v['not shoes'])
            ),
            v => v && v + ' ' + obj.gender
          ) || '',
        category: thru(
          findByWords(this.lists.categories, obj.productName),
          category => (category ? `${obj.gender} ${category}` : '')
        ),
        category_tree: obj.category_tree.join('_')
        // fit: obj.fit || '指定なし'
      }))
      // concatMap(obj => {
      //   if (!isItaly) return of(obj)
      //   client.set('headers', {
      //     Cookie: _.thru(
      //       _.get(client, ['headers', 'cookie']),
      //       cookieStr =>
      //         cookieStr &&
      //         (_.includes(cookieStr, Cookie.jp)
      //           ? cookieStr.replace(Cookie.jp, Cookie.it)
      //           : Cookie.it + cookieStr)
      //     )
      //   })

      //   return RxFetch($.documentInfo().url, {}, 'utf8', false).pipe(
      //     catchError(err => of(err.$ as client.CheerioStaticEx)),
      //     map($$ => ({
      //       ...obj,
      //       euro_price:
      //         $$ &&
      //         $$('#main .regular-price .price, #main .old-price .price')
      //           .first()
      //           .text()
      //           .replace(/,|\s|¥|€/g, '')
      //     })),
      //     tap(() =>
      //       client.set('headers', {
      //         Cookie: _.thru(
      //           _.get(client, ['headers', 'cookie']),
      //           cookieStr =>
      //             cookieStr &&
      //             (_.includes(cookieStr, Cookie.it)
      //               ? cookieStr.replace(Cookie.it, Cookie.jp)
      //               : Cookie.jp + cookieStr)
      //         )
      //       })
      //     )
      //   )
      // })
    )
  }
}
