import * as client from 'cheerio-httpcli'
import { Observable, Observer, from, MonoTypeOperatorFunction, of } from 'rxjs'
import { retry, flatMap, map, catchError } from 'rxjs/operators'
import * as encode from './encoding'
import axios from 'axios'
import * as uuidv5 from 'uuid/v5'
import * as fs from 'fs-extra'
import * as path from 'path'
import { retryWithDelay } from './operators'
const imgFile = path.join(__dirname, '../data/img')

export function RxFetch(url: string, params?: {}, encoding: 'utf8' | 'sjis' = 'utf8') {
  return from(new Promise((resolve, reject) => {
    client.fetch(url + ((params === undefined || params === {}) ? '' : '?' + serialize(params)))
      .then(res => {
        console.log(url)
        resolve(res.$)
      })
      .catch(err => reject(err))
  }) as Promise<client.CheerioStaticEx>)
    .pipe(
      retryWithDelay(10000, 10) as MonoTypeOperatorFunction<client.CheerioStaticEx>
    )
}

export function uploadImg(url: string, isURL = true) {
  const uuid = uuidv5(url, isURL ? uuidv5.URL : uuidv5.DNS)
  const extension = (url.match(/\.(gif|jpg|jpeg|tiff|png)/i) || ['.jpg'])[0]
  const fileName = path.join(imgFile, uuid + extension)

  return from(axios.get(url, { responseType: 'arraybuffer' }))
    .pipe(
      flatMap(res => fs.outputFile(fileName, new Buffer(res.data), 'binary')),
      map(() => uuid + extension),
      catchError(err => of(''))
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


export function serialize(obj: {}, encoding: 'utf8' | 'sjis' = 'sjis', sort = false) {
  const str = sort ? Object.keys(obj).sort() : Object.keys(obj)
  for (let i = 0, len = str.length; i < len; i++) {
    const key = str[i]

    switch (encoding) {
      case 'sjis':
        str[i] = encode.EscapeSJIS(key) + '=' + encode.EscapeSJIS(String(obj[key]))
        break
      case 'utf8':
        str[i] = encodeURIComponent(key) + '=' + encodeURIComponent(String(obj[key]))
    }
  }
  return str.join("&")
}
