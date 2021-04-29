import { EMPTY, from, MonoTypeOperatorFunction, pipe } from 'rxjs'
import { map, tap, delay, mergeMap } from 'rxjs/operators'
import * as encode from './encoding'
import * as tough from 'tough-cookie'
import AxiosCookiejarSupport from 'axios-cookiejar-support'
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import { retryWithDelay } from './operators'
import * as https from 'https'
import * as URLSearchParams from 'url-search-params'
import * as cheerio from 'cheerio'
import { merge } from 'lodash'
import { ChildInstance, CheerioStaticEx } from 'cheerio-httpcli'

export const httpsAgent = new https.Agent({
  keepAlive: false
})
export const userAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.13; rv:62.0) Gecko/20100101 Firefox/62.0'
export function RxFetch(
  client: ChildInstance,
  url: string,
  params?: {},
  encoding: 'utf8' | 'sjis' = 'utf8',
  retryWhenError = false
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
          console.log($.documentInfo().url)
          resolve($)
        })
        .catch(err => reject(err))
    }) as Promise<CheerioStaticEx>
  ).pipe(
    retryWhenError
      ? pipe(
          delay(500),
          retryWithDelay(2000, 1) as MonoTypeOperatorFunction<CheerioStaticEx>
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
      axios.post(
        $.attr('action'),
        new URLSearchParams(formObj($ as any)).toString(),
        {
          jar,
          withCredentials: true,
          httpsAgent,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'user-agent': userAgent
          }
        }
      )
    ),
    tap(() => console.log(loginUrl)),
    map(() =>
      jar
        .serializeSync()
        ?.cookies?.map(({ key, value }) => `${key}=${value}`)
        .join('; ')
    )
  )
}

export const fetchAndSaveCookies = (
  client: ChildInstance,
  config: AxiosRequestConfig
) => {
  const jar = new tough.CookieJar()
  return from(
    axios(
      merge(
        {
          httpsAgent,
          headers: { 'User-Agent': userAgent },
          withCredentials: true,
          jar
        },
        config
      )
    )
  ).pipe(
    map(() =>
      jar
        .serializeSync()
        ?.cookies?.map(({ key, value }) => `${key}=${value}`)
        .join('; ')
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
      jar
        .serializeSync()
        ?.cookies?.map(({ key, value }) => `${key}=${value}`)
        .join('; ')
    )
  )
}
