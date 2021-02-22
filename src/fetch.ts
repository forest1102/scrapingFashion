import * as client from 'cheerio-httpcli'
import { EMPTY, from, MonoTypeOperatorFunction, pipe } from 'rxjs'
import { map, tap, delay, mergeMap } from 'rxjs/operators'
import * as encode from './encoding'
import * as tough from 'tough-cookie'
import AxiosCookiejarSupport from 'axios-cookiejar-support'
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import { retryWithDelay } from './operators'
import * as https from 'https'
import * as _ from 'lodash'
import * as URLSearchParams from 'url-search-params'
import * as cheerio from 'cheerio'

export const httpsAgent = new https.Agent({
  keepAlive: false
})
export const userAgent =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36'
client.set('headers', { 'Accept-Language': 'ja,en-US' })
client.set('headers', {
  'Connection': 'Keep-Alive',
  'Keep-Alive': 'timeout=600;max=100'
})
export function RxFetch(
  url: string,
  params?: {},
  encoding: 'utf8' | 'sjis' = 'utf8',
  retryWhenError = true
) {
  if (!url) return EMPTY
  return from(
    // tslint:disable-next-line: no-unnecessary-type-assertion
    new Promise((resolve, reject) => {
      client
        .fetch(
          url +
            (params === undefined || params === {}
              ? ''
              : '?' + serialize(params))
        )
        .then(({ $, response }) => {
          console.log(url)
          resolve($)
        })
        .catch(err => reject(err))
    }) as Promise<client.CheerioStaticEx>
  ).pipe(
    retryWhenError
      ? pipe(
          delay(500),
          retryWithDelay(
            2000,
            3
          ) as MonoTypeOperatorFunction<client.CheerioStaticEx>
        )
      : pipe()
  )
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
AxiosCookiejarSupport(axios)
export const submitLoginForm = (
  loginUrl: string,
  formSelector: string,
  formObj: ($: Cheerio) => { [key: string]: string }
) => {
  const jar = new tough.CookieJar()
  return from(axios.get(loginUrl, { jar, withCredentials: true })).pipe(
    map(({ data }) => cheerio.load(data)),
    map($ => $(formSelector)),
    mergeMap($ =>
      axios.post($.attr('action'), new URLSearchParams(formObj($)).toString(), {
        jar,
        withCredentials: true,
        httpsAgent,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'user-agent': userAgent
        }
      })
    ),
    tap(() => console.log(loginUrl)),
    map(() =>
      _.chain(jar.serializeSync())
        .get('cookies')
        .map(({ key, value }) => `${key}=${value}`)
        .join('; ')
        .value()
    )
  )
}

export const fetchAndSaveCookies = (config: AxiosRequestConfig) => {
  const jar = new tough.CookieJar()
  return from(
    axios({
      ...config,
      httpsAgent,
      headers: { 'User-Agent': userAgent },
      withCredentials: true,
      jar
    })
  ).pipe(
    map(() =>
      _.chain(jar.serializeSync())
        .get('cookies')
        .map(({ key, value }) => `${key}=${value}`)
        .join('; ')
        .value()
    ),
    tap(cookieStr => client.set('headers', { Cookie: cookieStr }))
  )
}

export const getAuthCredential = (
  url: string,
  field: { [key: string]: string },
  header: AxiosRequestConfig = {}
) => {
  const jar = new tough.CookieJar()

  return from(
    axios.post(url, new URLSearchParams(field).toString(), {
      jar: jar,
      withCredentials: true,
      httpsAgent,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'user-agent': userAgent
      },
      ...header
    })
  ).pipe(
    tap(() => console.log(url)),
    map(() =>
      _.chain(jar.serializeSync())
        .get('cookies')
        .map(({ key, value }) => `${key}=${value}`)
        .join('; ')
        .value()
    )
  )
}
