import { getElementObj, getAllPagesRx } from '../../observable'
import { from, of } from 'rxjs'
import { map, filter } from 'rxjs/operators'

import { Scraper } from '../../scraperType'
import { CheerioStaticEx } from 'cheerio-httpcli'

export default class Monti extends Scraper {
  NEXT_SELECTOR = 'a.next'
  beforeFetchPages = (url: string) => {
    this.client.set('headers', {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.109 Safari/537.36',
      'Cookie':
        'TassoCambio=' + 'IsoTassoCambio=EUR' + '; geoLoc=id=105&nome=Japan'
    })
    return of(url)
  }
  toItemPageUrlObservable = ($: CheerioStatic, url: string) =>
    from($('.products .product').toArray()).pipe(
      filter(el => !/sold out/i.test($(el).text())),
      map(el => of({ url: $('a.link', el).attr('href'), others: {} }))
    )
  extractData = ($: CheerioStaticEx, others: { [key: string]: string }) =>
    of(
      getElementObj($, {
        category: [
          '.site-location li',
          e =>
            e
              .toArray()
              .slice(1)
              .map(el =>
                $(el)
                  .text()
                  .trim()
              )
              .join(' ')
        ],
        brand: [
          'h1[itemprop="brand"] span[itemprop="name"]',
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
          'h2[itemprop="name"]',
          e =>
            e
              .first()
              .text()
              .trim()
              .replace(/`|'/g, '')
        ],
        price: [
          '.price span[itemprop="price"]',
          e =>
            (e.attr('content').match(/[0-9.,]+/) || [''])[0].replace(
              /[,.]00$|\./g,
              ''
            )
        ],

        old_price: [
          '.price .old',
          e =>
            ((
              e
                .first()
                .text()
                .trim() || ''
            ).match(/[0-9,.]+/) || [''])[0].replace(/,00$|\./g, '')
        ],
        sizes: [
          '#idTaglia option',
          e =>
            e
              .toArray()
              .map(el =>
                $(el)
                  .text()
                  .trim()
                  .replace(/(\d+)[+½]/, '$1.5')
                  .replace(/\s+/, ' ')
              )
              .filter(str => !/uni/i.test(str))
        ],
        description: [
          '#description-tab',
          e =>
            e
              .first()
              .html()
              .replace(/<\/?(strong|p|b)>/g, '')
              .trim()
        ],
        image: [
          '.slide a',
          e => e.toArray().map(el => el.attribs['href'] || '')
        ]
        // currency:[
        //   'span[itemprop="priceCurrency"]',
        //   e=>e.attr('content')
        // ]
      })
    ).pipe(
      map(obj => {
        const unit = ''
        return {
          ...obj,
          currency: '€',
          season: '',
          gender: ''
        }
      }),
      map(({ description, sizes, ...others }) => ({
        ...others,
        description,
        size: sizes.map(str => str.replace(/.+? (.+?)/, '$1')),
        size_chart:
          sizes && sizes[0] ? (sizes[0].match(/(.+?) .+?/) || [])[1] : '',
        sku: (description.match(/(?<=Product code: ).*?(?=<br>|$)/i) || [''])[0]
          .trim()
          .toUpperCase(),
        color: [(description.match(/(?<=Color: ).*/i) || [''])[0]],
        size_info: (() => {
          const heelHeight = description.match(/(?<=heel: )[0-9,.cminh ]+/i)
          if (heelHeight) return 'ヒール： ' + heelHeight[0]

          // const sizeStr = description.match(/(?<=Dimension: )[0-9,.cminhx ]+/i)
          const sizeReg = /(Width|height|depth) ([0-9,.,cminhx ]+)(?=,|$)/gi
          let match: RegExpExecArray
          let info = ''

          while (
            (match = sizeReg.exec(description)) !== null &&
            match[1] !== null &&
            match[2] !== null
          ) {
            switch (match[1].toLocaleLowerCase()) {
              case 'width':
                info += '幅： ' + match[2].replace(/\s/g, '')
                break
              case 'height':
                info += '高さ： ' + match[2].replace(/\s/g, '')
                break
              case 'depth':
                info += 'マチ： ' + match[2].replace(/\s/g, '')
                break
            }
          }

          return info
        })()
      }))
    )
}

// const start = moment()
// const dataStream = fs.createWriteStream(
//   path.join(__dirname, '../data/data.csv'),
//   'utf8'
// )
// const BASE_URL = 'https://www.montiboutique.com'
// const toUrl = addBaseURL(BASE_URL)
// from(fs.readJSON(path.join(__dirname, '../data/urls.json')))
//   .pipe(
//     flatMap(arr => arr as string[]),
//     concatMap(url =>
//       getAllPagesRx(this.client,url, 'a.next').pipe(
//         toArray(),
//         flatMap(v => v),
//         concatMap($ =>
//           from($('.products .product').toArray()).pipe(
//             filter(el => !/sold out/i.test($(el).text())),
//             map(el => $('a.link', el).attr('href')),
//             concatMap(_url => RxFetch(toUrl(_url))),
//             retry(10)
//           )
//         ),
//         map($ => {
//           const unit = ''
//           return {
//             ...(getElementObj($, {
//               category: [
//                 '.site-location li',
//                 e =>
//                   e
//                     .toArray()
//                     .slice(1)
//                     .map(el => $(el).text().trim())
//                     .join(' ')
//               ],
//               brand: [
//                 'h1[itemprop="brand"] span[itemprop="name"]',
//                 e =>
//                   e
//                     .first()
//                     .text()
//                     .trim()
//                     .replace(/`|'/g, '')
//                     .replace(/[àâä]/g, 'a')
//                     .replace(/[ÀÂÄ]/g, 'A')
//                     .replace(/[éèêë]/g, 'e')
//                     .replace(/[ÉÈÊË]/g, 'e')
//                     .replace(/[îï]/g, 'i')
//                     .replace(/[ÎÏ]/g, 'I')
//                     .replace(/[ôö]/g, 'o')
//                     .replace(/[ÔÖ]/g, 'O')
//                     .replace(/[ùûü]/g, 'u')
//                     .replace(/[ÙÛÜ]/g, 'U')
//                     .replace(/[ÿ]/g, 'y')
//                     .replace(/[Ÿ]/g, 'Y')
//               ],
//               productName: [
//                 'h2[itemprop="name"]',
//                 e => e.first().text().trim().replace(/`|'/g, '')
//               ],
//               price: [
//                 '.price span[itemprop="price"]',
//                 e =>
//                   (e.attr('content').match(/[0-9.,]+/) || [''])[0].replace(
//                     /[,.]00$|\./g,
//                     ''
//                   )
//               ],

//               old_price: [
//                 '.price .old',
//                 e =>
//                   ((e.first().text().trim() || '').match(/[0-9,.]+/) || [
//                     ''
//                   ])[0].replace(/,00$|\./g, '')
//               ],
//               sizes: [
//                 '#idTaglia option',
//                 e =>
//                   e
//                     .toArray()
//                     .map(el =>
//                       $(el)
//                         .text()
//                         .trim()
//                         .replace(/(\d+)[+½]/, '$1.5')
//                         .replace(/\s+/, ' ')
//                     )
//                     .filter(str => !/uni/i.test(str))

//                 // .join(',')
//               ],
//               description: [
//                 '#description-tab',
//                 e =>
//                   e
//                     .first()
//                     .html()
//                     .replace(/<\/?(strong|p|b)>/g, '')
//                     .trim()
//               ],
//               image: [
//                 '.slide a',
//                 e => e.toArray().map(el => el.attribs['href'] || '')
//               ]
//               // currency:[
//               //   'span[itemprop="priceCurrency"]',
//               //   e=>e.attr('content')
//               // ]
//             }) as { image: string[]; description: string; sizes: string[] }),
//             currency: '€',
//             update: moment().format('YYYY/M/D HH:mm:ss'),
//             URL: $.documentInfo().url
//           }
//         }),
//         map(({ description, sizes, ...others }) => ({
//           ...others,
//           description,
//           size: sizes.map(str => str.replace(/.+? (.+?)/, '$1')).join(','),
//           size_chart:
//             sizes && sizes[0] ? (sizes[0].match(/(.+?) .+?/) || [])[1] : '',
//           sku: (description.match(/(?<=Product code: ).*?(?=<br>|$)/i) || [
//             ''
//           ])[0]
//             .trim()
//             .toUpperCase(),
//           color: (description.match(/(?<=Color: ).*/i) || [''])[0],
//           size_info: (() => {
//             const heelHeight = description.match(/(?<=heel: )[0-9,.cminh ]+/i)
//             if (heelHeight) return 'ヒール： ' + heelHeight[0]

//             // const sizeStr = description.match(/(?<=Dimension: )[0-9,.cminhx ]+/i)
//             const sizeReg = /(Width|height|depth) ([0-9,.,cminhx ]+)(?=,|$)/gi
//             let match: RegExpExecArray
//             let info = ''

//             while (
//               (match = sizeReg.exec(description)) !== null &&
//               match[1] !== null &&
//               match[2] !== null
//             ) {
//               switch (match[1].toLocaleLowerCase()) {
//                 case 'width':
//                   info += '幅： ' + match[2].replace(/\s/g, '')
//                   break
//                 case 'height':
//                   info += '高さ： ' + match[2].replace(/\s/g, '')
//                   break
//                 case 'depth':
//                   info += 'マチ： ' + match[2].replace(/\s/g, '')
//                   break
//               }
//             }

//             return info
//           })()
//         })),
//         concatMap(({ image, ...others }) =>
//           from(image).pipe(
//             concatMap(img => uploadImg(toUrl(img))),
//             reduce(
//               (acc, val: string, i) => ({
//                 [`img${i + 1}`]: image[i],
//                 [`imgfile${i + 1}`]: val,
//                 ...acc
//               }),
//               others
//             )
//           )
//         ),
//         tap(x => console.log(x)),
//         map(obj =>
//           Object.keys(toArrIndex).reduce(
//             (acc, cur) => ({
//               [cur]: (obj[toArrIndex[cur]] || '').replace(/[\r\n]/g, ''),
//               ...acc
//             }),
//             {} as { [key: number]: string }
//           )
//         ),
//         map(obj =>
//           Object.keys(obj)
//             .reduce((acc, cur) => {
//               acc[cur] = `"${obj[cur]}"`
//               return acc
//             }, [])
//             .join(',')
//         ),
//         tap(v => dataStream.write(v + '\n'))
//       )
//     )
//   )
//   .subscribe(
//     v => {},
//     err => console.error(err.body || err),
//     () => console.log('Completed!', `time: ${moment().diff(start, 'second')}s`)
//   )
