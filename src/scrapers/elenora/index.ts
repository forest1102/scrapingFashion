import axios from 'axios'
import * as tough from 'tough-cookie'
import * as cheerio from 'cheerio'
import * as qs from 'qs'
import { getElementObj, getAllPagesRx } from '../../observable'
import { from, of } from 'rxjs'
import { map, tap, flatMap, filter } from 'rxjs/operators'
import * as client from 'cheerio-httpcli'

import { Scraper } from '../../scraperType'
import { CheerioStaticEx } from 'cheerio-httpcli'
import axiosCookieJarSupport from 'axios-cookiejar-support'
import * as _ from 'lodash'

export default class Elenora extends Scraper {
  NEXT_SELECTOR = '#body_content_hl_LastPage'
  cookieJar = new tough.CookieJar()

  beforeFetchPages = (url: string) => {
    axiosCookieJarSupport(axios)
    return from(
      axios({
        url: 'https://eleonorabonucci.com/login',
        method: 'GET'
      })
    ).pipe(
      map(({ data }) => cheerio.load(data)),
      map($ => ({
        ctl00$body_content$ctrlLogin$txt_DESCCL_email: 'hedirockmode@gmail.com',
        ctl00$body_content$ctrlLogin$txt_DESCCL_password: 'DCJKIHZ',
        __EVENTTARGET: 'ctl00$body_content$ctrlLogin$lnkACCEDI' || '',
        __EVENTARGUMENT: $('input[name="__EVENTARGUMENT"]').attr('value') || '',
        __LASTFOCUS: $('input[name="__LASTFOCUS"]').attr('value') || '',
        __VIEWSTATE: $('input[name="__VIEWSTATE"]').attr('value') || '',
        __VIEWSTATEGENERATOR:
          $('input[name="__VIEWSTATEGENERATOR"]').attr('value') || '',
        __PREVIOUSPAGE: $('input[name="__PREVIOUSPAGE"]').attr('value') || '',
        __EVENTVALIDATION:
          $('input[name="__EVENTVALIDATION"]').attr('value') || ''
      })),
      map(obj =>
        qs.stringify(obj, {
          sort: (a: string, b: string) => a.localeCompare(b)
        })
      ),
      // tap(query => console.log(query)),
      flatMap(body =>
        axios({
          url: 'https://eleonorabonucci.com/login',
          method: 'POST',
          data: body,
          jar: this.cookieJar,
          withCredentials: true,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      ),
      map(_ =>
        this.cookieJar
          .toJSON()
          .cookies.filter(
            cookie =>
              cookie.key === 'Basket_WEB' || cookie.key === 'ASP.NET_SessionId'
          )
          .map(cookie => `${cookie.key}=${cookie.value}`)
          .join(';')
      ),
      tap(cookie => {
        client.set('headers', {
          Cookie: cookie
        })
      })
    )
  }
  toItemPageUrlObservable = ($: CheerioStaticEx, url: string) =>
    from($('.div_LIST').toArray()).pipe(
      filter(el => !/sold out/i.test($(el).text())),
      map(el =>
        of({
          url: $('#spanIMG', el).attr('href'),
          others: {}
        })
      )
    )
  extractData = ($: CheerioStaticEx, others: {}) =>
    of(
      getElementObj($, {
        category: [
          '.Generatore_Percorso',
          e =>
            e
              .toArray()
              .slice(2)
              .map(el => $(el).text().trim())
              .join(' ')
        ],
        brand: [
          '#body_content_lnkBRAND',
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
          '#body_content_lblNOME',
          e => e.first().text().trim().replace(/`|'/g, '')
        ],
        price: [
          '#body_content_meta_price',
          e => {
            const price = e.attr('content')
            if (_.isNil(price)) return ''
            const parsedPrice = parseInt(price)
            if (_.isNaN(parsedPrice)) return ''
            return String(parsedPrice / 100)
          }
        ],

        old_price: [
          '.SP_PREZZO',
          e =>
            ((
              e.find('#body_content_lblPrezzoIniziale').text() ||
              e.find('.EXTRA_PrezzoPubblico').text()
            ).match(/[0-9,.]+/) || [''])[0]
        ],
        size: [
          '#body_content_mnuTaglie tr a',
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

          // .join(',')
        ],
        description: [
          '#body_content_TabInfoClienti_tabMoreInfo_lblDecrizione',
          e =>
            e
              .html()
              .replace(/<\/?(strong|p|b)>/g, '')
              .trim()
              .toLowerCase()
        ],
        color: ['#body_content_lblNowColore', e => [e.text().trim()]],
        image: [
          '#pnlDSA img',
          e =>
            e
              .toArray()
              .map(el => (el.attribs['src'] || '').replace('/96/0', '/900'))
        ],
        sku: ['#body_content_lbl_Codice', e => e.text().trim()]
        // currency:[
        //   'span[itemprop="priceCurrency"]',
        //   e=>e.attr('content')
        // ]
      })
    ).pipe(
      map(({ description, ...others }) => ({
        ...others,
        currency: '€',
        description,
        size_chart: '',
        gender: '',
        season: '',
        size_info: (() => {
          const reg = /(hem|length|dimensions|tacco): ([0-9, cminx"]+)/gi
          let m: RegExpExecArray
          const result = []

          if ((m = /(?=model wears size) [0-9.,incm"]+/.exec(description))) {
            result.push('画像モデル着用サイズ：' + m[0])
          }

          while ((m = reg.exec(description)) && m.length > 2) {
            // console.log(m)
            switch (m[1]) {
              case 'crotch':
                result.push('股上：　約' + m[2])
                break
              case 'length':
                result.push('丈：　約' + m[2])
                break
              case 'hem':
                result.push('ヘム幅：　約' + m[2])
                break
              case 'dimensions':
                const dimensions = m[2].match(
                  /([0-9.,cmin ]+) x ([0-9.,cmin ]+) x([0-9.,cmin ]+)/
                )
                if (!dimensions || dimensions.length < 3) break
                result.push(
                  `約${dimensions[1]}X 約${dimensions[2]} X 約${dimensions[3]} ㎝`
                )
                break
              case 'tacco':
                result.push('ヒール：　約' + m[2])
                break
              default:
                break
            }
          }
          return result.join('\r\n')
        })()
      }))
    )
}

// const BASE_URL = 'https://eleonorabonucci.com'
// const toUrl = addBaseURL(BASE_URL)
// from(
//   axios({
//     url: 'https://eleonorabonucci.com/login',
//     method: 'GET'
//   })
// )
//   .pipe(
//     map(({ data }) => cheerio.load(data)),
//     map($ => ({
//       ctl00$body_content$ctrlLogin$txt_DESCCL_email: 'hedirockmode@gmail.com',
//       ctl00$body_content$ctrlLogin$txt_DESCCL_password: 'DCJKIHZ',
//       __EVENTTARGET: 'ctl00$body_content$ctrlLogin$lnkACCEDI' || '',
//       __EVENTARGUMENT: $('input[name="__EVENTARGUMENT"]').attr('value') || '',
//       __LASTFOCUS: $('input[name="__LASTFOCUS"]').attr('value') || '',
//       __VIEWSTATE: $('input[name="__VIEWSTATE"]').attr('value') || '',
//       __VIEWSTATEGENERATOR:
//         $('input[name="__VIEWSTATEGENERATOR"]').attr('value') || '',
//       __PREVIOUSPAGE: $('input[name="__PREVIOUSPAGE"]').attr('value') || '',
//       __EVENTVALIDATION:
//         $('input[name="__EVENTVALIDATION"]').attr('value') || ''
//     })),
//     map(obj =>
//       qs.stringify(obj, {
//         sort: (a: string, b: string) => a.localeCompare(b)
//       })
//     ),
//     // tap(query => console.log(query)),
//     flatMap(body =>
//       axios({
//         url: 'https://eleonorabonucci.com/login',
//         method: 'POST',
//         data: body,
//         jar: cookieJar,
//         withCredentials: true,
//         headers: {
//           'Content-Type': 'application/x-www-form-urlencoded'
//         }
//       })
//     ),
//     map(_ =>
//       cookieJar
//         .toJSON()
//         .cookies.filter(
//           cookie =>
//             cookie.key === 'Basket_WEB' || cookie.key === 'ASP.NET_SessionId'
//         )
//         .map(cookie => `${cookie.key}=${cookie.value}`)
//         .join(';')
//     ),
//     tap(cookie => {
//       client.set('headers', {
//         Cookie: cookie
//       })
//     }),
//     flatMap(() =>
//       from(fs.readJSON(path.join(__dirname, '../data/urls.json'))).pipe(
//         flatMap(arr => arr as string[]),
//         concatMap(url =>
//           getAllPagesRx(url, '#body_content_hl_LastPage').pipe(
//             toArray(),
//             flatMap(v => v),
//             concatMap($ =>
//               from($('.div_LIST').toArray()).pipe(
//                 filter(el => !/sold out/i.test($(el).text())),
//                 map(el => $('#spanIMG', el).attr('href')),
//                 concatMap(_url => RxFetch(toUrl(_url))),
//                 retry(10)
//               )
//             ),
//             map($ => {
//               const unit = ''
//               return {
//                 ...(getElementObj($, {
//                   category: [
//                     '.Generatore_Percorso',
//                     e =>
//                       e
//                         .toArray()
//                         .slice(2)
//                         .map(el => $(el).text().trim())
//                         .join(' ')
//                   ],
//                   brand: [
//                     '#body_content_lnkBRAND',
//                     e =>
//                       e
//                         .first()
//                         .text()
//                         .trim()
//                         .replace(/`|'/g, '')
//                         .replace(/[àâä]/g, 'a')
//                         .replace(/[ÀÂÄ]/g, 'A')
//                         .replace(/[éèêë]/g, 'e')
//                         .replace(/[ÉÈÊË]/g, 'e')
//                         .replace(/[îï]/g, 'i')
//                         .replace(/[ÎÏ]/g, 'I')
//                         .replace(/[ôö]/g, 'o')
//                         .replace(/[ÔÖ]/g, 'O')
//                         .replace(/[ùûü]/g, 'u')
//                         .replace(/[ÙÛÜ]/g, 'U')
//                         .replace(/[ÿ]/g, 'y')
//                         .replace(/[Ÿ]/g, 'Y')
//                   ],
//                   productName: [
//                     '#body_content_lblNOME',
//                     e => e.first().text().trim().replace(/`|'/g, '')
//                   ],
//                   price: [
//                     '#body_content_meta_price',
//                     e => (parseInt(e.attr('content')) || 0) / 100 || ''
//                   ],

//                   old_price: [
//                     '.SP_PREZZO',
//                     e =>
//                       ((
//                         e.find('#body_content_lblPrezzoIniziale').text() ||
//                         e.find('.EXTRA_PrezzoPubblico').text()
//                       ).match(/[0-9,.]+/) || [''])[0]
//                   ],
//                   sizes: [
//                     '#body_content_mnuTaglie tr a',
//                     e =>
//                       e
//                         .toArray()
//                         .map(el =>
//                           $(el)
//                             .text()
//                             .trim()
//                             .replace(/(\d+)[+½]/, '$1.5')
//                             .replace(/\s+/, ' ')
//                         )
//                         .filter(str => !/uni/i.test(str))

//                     // .join(',')
//                   ],
//                   description: [
//                     '#body_content_TabInfoClienti_tabMoreInfo_lblDecrizione',
//                     e =>
//                       e
//                         .html()
//                         .replace(/<\/?(strong|p|b)>/g, '')
//                         .trim()
//                         .toLowerCase()
//                   ],
//                   color: ['#body_content_lblNowColore', e => e.text().trim()],
//                   image: [
//                     '#pnlDSA img',
//                     e =>
//                       e
//                         .toArray()
//                         .map(el =>
//                           (el.attribs['src'] || '').replace('/96/0', '/900')
//                         )
//                   ],
//                   sku: ['#body_content_lbl_Codice', e => e.text().trim()]
//                   // currency:[
//                   //   'span[itemprop="priceCurrency"]',
//                   //   e=>e.attr('content')
//                   // ]
//                 }) as {
//                   image: string[]
//                   description: string
//                   sizes: string[]
//                 }),
//                 currency: '€',
//                 update: moment().format('YYYY/M/D HH:mm:ss'),
//                 URL: $.documentInfo().url
//               }
//             }),
//             map(({ description, sizes, ...others }) => ({
//               ...others,
//               description,
//               size: sizes.join(','),
//               size_info: (() => {
//                 const reg = /(hem|length|dimensions|tacco): ([0-9, cminx"]+)/gi
//                 let m: RegExpExecArray
//                 const result = []

//                 if (
//                   (m = /(?=model wears size) [0-9.,incm"]+/.exec(description))
//                 ) {
//                   result.push('画像モデル着用サイズ：' + m[0])
//                 }

//                 while ((m = reg.exec(description)) && m.length > 2) {
//                   // console.log(m)
//                   switch (m[1]) {
//                     case 'crotch':
//                       result.push('股上：　約' + m[2])
//                       break
//                     case 'length':
//                       result.push('丈：　約' + m[2])
//                       break
//                     case 'hem':
//                       result.push('ヘム幅：　約' + m[2])
//                       break
//                     case 'dimensions':
//                       const dimensions = m[2].match(
//                         /([0-9.,cmin ]+) x ([0-9.,cmin ]+) x([0-9.,cmin ]+)/
//                       )
//                       if (!dimensions || dimensions.length < 3) break
//                       result.push(
//                         `約${dimensions[1]}X 約${dimensions[2]} X 約${dimensions[3]} ㎝`
//                       )
//                       break
//                     case 'tacco':
//                       result.push('ヒール：　約' + m[2])
//                       break
//                     default:
//                       break
//                   }
//                 }
//                 return result.join('\r\n')
//               })()
//             })),
//             concatMap(({ image, ...others }) =>
//               from(image).pipe(
//                 concatMap(img => uploadImg(toUrl(img))),
//                 reduce(
//                   (acc, val: string, i) => ({
//                     [`img${i + 1}`]: toUrl(image[i]),
//                     [`imgfile${i + 1}`]: val,
//                     ...acc
//                   }),
//                   others
//                 )
//               )
//             ),
//             tap(x => console.log(x)),
//             map(obj =>
//               Object.keys(toArrIndex).reduce(
//                 (acc, cur) => ({
//                   [cur]: obj[toArrIndex[cur]] || '',
//                   ...acc
//                 }),
//                 {} as { [key: number]: string }
//               )
//             ),
//             map(obj =>
//               Object.keys(obj)
//                 .reduce((acc, cur) => {
//                   acc[cur] = `"${obj[cur]}"`
//                   return acc
//                 }, [])
//                 .join(',')
//             ),
//             tap(v => dataStream.write(v + '\n'))
//           )
//         )
//       )
//     )
//   )
//   .subscribe(
//     v => {},
//     err => console.error(err.body || err),
//     () => console.log('Completed!', `time: ${moment().diff(start, 'second')}s`)
//   )
