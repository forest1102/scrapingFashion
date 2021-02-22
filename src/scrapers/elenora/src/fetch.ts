import * as client from 'cheerio-httpcli'
import { Observable, Observer, from } from 'rxjs'
import { retry, flatMap, map, tap } from 'rxjs/operators'
import * as encode from './encoding'
import axios from 'axios'
import { v5 as uuidv5 } from 'uuid'
import * as fs from 'fs-extra'
import * as path from 'path'
import * as asyncRetry from 'async-retry'
import * as cheerio from 'cheerio'
import { retryWithRandomDelay } from './operators'
const imgFile = path.join(__dirname, '../data/img')

export function RxFetch(
  url: string,
  params?: {},
  encoding: 'utf8' | 'sjis' = 'utf8'
) {
  return from(
    new Promise((resolve, reject) => {
      client
        .fetch(
          url +
            (params === undefined || params === {}
              ? ''
              : '?' + serialize(params))
        )
        .then(res => {
          console.log(url)
          // console.log(res.response.cookies);

          resolve(res.$)
        })
        .catch(err => reject(err))
    }) as Promise<client.CheerioStaticEx>
  ).pipe(
    retryWithRandomDelay(1000, 2500, 20, err => {
      if (err['body']) {
        const $ = cheerio.load(err['body'])
        console.log($('body').text())
      } else {
        console.log(err)
      }
      console.log('retrying...')
    })
  ) as Observable<client.CheerioStaticEx>
}

export function uploadImg(url: string, isURL = true) {
  const uuid = uuidv5(url, isURL ? uuidv5.URL : uuidv5.DNS)
  const extension = (url.match(/\.(gif|jpg|jpeg|tiff|png)/) || ['.jpg'])[0]
  const fileName = path.join(imgFile, uuid + extension)

  return from(axios.get(url, { responseType: 'arraybuffer' })).pipe(
    tap(v => console.log(v.config.url)),
    flatMap(res => fs.outputFile(fileName, new Buffer(res.data), 'binary')),
    map(() => uuid + extension),
    retryWithRandomDelay(3000, 10000, 20)
  )

  // const res = await asyncRetry(bail => axios.get(url, { responseType: 'arraybuffer' }), {
  // 	retries: 10,
  // 	onRetry: (e) => console.log('retrying... url:', url)
  // })
  // console.log(url)
  //
  // await fs.outputFile(fileName, new Buffer(res.data), 'binary')
  //
  // return uuid + '.jpg'
}

export function serialize(
  obj: {},
  encoding: 'utf8' | 'sjis' = 'sjis',
  sort = false
) {
  const str = sort ? Object.keys(obj).sort() : Object.keys(obj)
  for (let i = 0, len = str.length; i < len; i++) {
    const key = str[i]

    switch (encoding) {
      case 'sjis':
        str[i] =
          encode.EscapeSJIS(key) + '=' + encode.EscapeSJIS(String(obj[key]))
        break
      case 'utf8':
        str[i] =
          encodeURIComponent(key) + '=' + encodeURIComponent(String(obj[key]))
    }
  }
  return str.join('&')
}
