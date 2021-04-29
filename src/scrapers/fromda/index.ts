import { getElementObj } from '../../observable'
import { from, of } from 'rxjs'
import { RxFetch, submitLoginForm, fetchAndSaveCookies } from '../../fetch'
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

import { Scraper } from '../../scraperType'
import List from '../../lists'
import { ChildInstance, CheerioStaticEx } from 'cheerio-httpcli'
import {
  findByWords,
  filterByWords,
  swapElement,
  sizeCompare,
  execAllGen
} from '../../util'

export default class extends Scraper {
  private readonly Cookie = {
    it: 'delivery_country=IT; ',
    jp: 'delivery_country=JP; '
  }
  BASE_URL = 'https://www.tizianafausti.com/en/'
  NEXT_SELECTOR = '.next'

  constructor(
    lists: List,
    client: ChildInstance,
    isItaly: boolean,
    argv: any[]
  ) {
    super(lists, client, isItaly, argv)
    this.client.set('headers', { Cookie: this.Cookie.jp })
  }

  beforeFetchPages = (url: string) =>
    RxFetch(this.client, url).pipe(
      map($ => $('#valuta_EUR').val()),
      concatMap(post_url =>
        fetchAndSaveCookies(this.client, {
          url: post_url,
          method: 'POST'
        })
      ),
      tap(() =>
        this.client.set('headers', {
          Cookie: this.Cookie.jp + this.client.headers.cookie
        })
      ),
      tap(() => console.log(this.client.headers))
    )

  toItemPageUrlObservable = ($: CheerioStatic, url: string) =>
    from($('.products-grid li').toArray()).pipe(
      filter(el => !$('.stock.unavailable', el).length),
      map(el =>
        of({
          url: $('a.product-image', el)
            .first()
            .attr('href'),
          others: {}
        })
      )
    )

  extractData = ($: CheerioStaticEx, others: { [key: string]: string }) => {
    let unit = ''
    return of(
      getElementObj($, {
        brand: [
          '#main .productBrand',
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
          '#main .productName',
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
        price: [
          '#main .special-price .price,#main .regular-price .price',
          e =>
            e
              .first()
              .text()
              .replace(/,|\s|¥|€/g, '')
        ],
        old_price: [
          '#main .old-price .price',
          e =>
            e
              .first()
              .text()
              .replace(/,|\s|¥|€/g, '')
        ],
        size: [
          '#lista-taglie-disponibili > li',
          e =>
            e
              .toArray()
              .map(el => ({
                key: (el.attribs['id'] || '')
                  .replace('selezione-taglia-', '')
                  .toUpperCase()
                  .trim(),
                value: $(el)
                  .find('li')
                  .toArray()
                  .map(_el =>
                    $(_el)
                      .text()
                      .trim()
                  )
              }))
              .reduce(
                (acc, cur) => ({ ...acc, [cur.key]: cur.value }),
                {} as { [key: string]: string[] }
              )
        ],
        size_chart: ['#frase_taglia > div', e => e.text().trim()],
        season: [
          'head',
          e =>
            _.head(
              _.get(
                e
                  .contents()
                  .toArray()
                  .find(el => el.type === 'comment'),
                'nodeValue',
                ''
              ).match(/(Spring\/Summer|Fall\/Winter) \d{4}/i)
            ) || ''
        ],
        sku: ['.productCodice span', e => e.text().trim()],
        description: [
          '#description-acc',
          e =>
            e
              .html()
              .replace(/<\/?br\s?>/g, '\n')
              .replace(
                / {2,}|<script(?: type=".*?")?>[\s\S]+?<\/script>|<\/?\w+?(?: \w+=".+?")*?\/?>/g,
                ''
              )
              .trim()
        ],
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
          '#product-images-wrapper .main-image img',
          e => e.toArray().map(el => el.attribs['src'] || '')
        ],
        category_tree: [
          '#breadcrumbs-wrapper li:not(.home)',
          e =>
            _.chain(e.toArray())
              .map(el => ($(el).text() || '').trim())
              .value()
        ],
        color: [
          '#main .color-value',
          e =>
            e.toArray().map(el =>
              $(el)
                .text()
                .trim()
                .toUpperCase()
            )
        ]
      })
    ).pipe(
      map(obj => ({
        ...obj,
        size: _.get(obj.size, [obj.size_chart], ['OS']),
        color: obj.color.filter(c => this.lists.colorMap[c]),
        gender: _.includes(obj.description, 'Gender: woman') ? 'WOMEN' : 'MEN'
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
        currency: '€'
        // image: _.includes(obj.category_tree, 'Shoes')
        //   ? swapElement(obj.image, 0, 1)
        //   : obj.image
      })),
      map(obj => {
        const size_infos: string[] = []
        const descText = obj.description

        let tmp: RegExpMatchArray
        let country = ''
        let size_chart = obj.size_chart

        // if ((tmp = descText.match(/(?<=wedge )[0-9,.cm ]+/)))
        //   size_infos.push(tmp[0])

        // if ((tmp = descText.match(/(cm|mm) (\d+x\d+x\d+)/)))
        //   size_infos.push(tmp[2] + tmp[1])
        if ((tmp = descText.match(/heel height: ([0-9,.]+) inch/i))) {
          const inches = parseFloat(tmp[1])
          if (inches !== NaN)
            size_infos.push(`Heel height: 約${Math.round(inches * 2.54)}cm`)
        }

        for (let tmp of execAllGen(
          /^(?:Dimension:)?(length|thickness|height).*?: ([0-9,.]+) inch/gi,
          descText
        )) {
          const inches = parseFloat(tmp[2])

          if (inches !== NaN)
            size_infos.push(`${tmp[1]}: 約${Math.round(inches * 2.54)}cm`)
        }

        if (
          !_.isEmpty(size_infos) &&
          (tmp = descText.match(/made in (\w+)/i))
        ) {
          country = tmp[1]
          size_infos.push(tmp[0])
        }

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
        //   //   _.get(lists.AHsize, [
        //   //     obj.brand_sex.toUpperCase(),
        //   //     _.includes(obj.category_tree, 'Shoes') ? 'shoes' : 'not shoes'
        //   //   ]) || size_chart

        //   if (!size_chart && (tmp = obj.fit.match(/(\w+)\ssizing/i))) {
        //     size_chart = tmp[1].trim()
        //   }

        //   size_chart =
        //     size_chart &&
        //     size_chart +
        //       (findByWords(lists.shoes, obj.productName) ? ' SHOES' : '') +
        //       (' ' + obj.gender)

        //   size_chart = !size_chart && obj.size[0] === 'UNI' ? 'UNI' : size_chart
        //   size_chart = !size_chart ? '指定なし' : size_chart
        // } else {
        //   size_chart = '指定なし'
        // }

        size_chart = size_chart
          ? size_chart +
            (findByWords(this.lists.shoes, obj.productName) ? ' SHOES' : '') +
            (' ' + obj.gender)
          : '指定なし'
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
        category_tree: obj.category_tree.join('-')
        // fit: obj.fit || '指定なし'
      })),
      concatMap(obj => {
        if (!this.isItaly) return of(obj)
        this.client.set('headers', {
          Cookie: _.thru(
            _.get(this.client, ['headers', 'cookie']),
            cookieStr =>
              cookieStr &&
              (_.includes(cookieStr, this.Cookie.jp)
                ? cookieStr.replace(this.Cookie.jp, this.Cookie.it)
                : this.Cookie.it + cookieStr)
          )
        })

        return RxFetch(
          this.client,
          $.documentInfo().url,
          {},
          'utf8',
          false
        ).pipe(
          catchError(err => of(err.$ as CheerioStaticEx)),
          map($$ => ({
            ...obj,
            euro_price:
              $$ &&
              $$('#main .regular-price .price, #main .old-price .price')
                .first()
                .text()
                .replace(/,|\s|¥|€/g, '')
          })),
          tap(() =>
            this.client.set('headers', {
              Cookie: _.thru(
                _.get(this.client, ['headers', 'cookie']),
                cookieStr =>
                  cookieStr &&
                  (_.includes(cookieStr, this.Cookie.it)
                    ? cookieStr.replace(this.Cookie.it, this.Cookie.jp)
                    : this.Cookie.jp + cookieStr)
              )
            })
          )
        )
      })
    )
  }
}
