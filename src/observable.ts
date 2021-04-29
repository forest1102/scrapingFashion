import { CheerioStaticEx, ChildInstance } from 'cheerio-httpcli'
import { RxFetch } from './fetch'
import { map, flatMap, repeat, tap, expand } from 'rxjs/operators'
import { from, concat, Observable, Observer, empty } from 'rxjs'
import * as isUrl from 'is-url'
import * as urlPath from 'url'

const absUrlReg = /https\:\/\/.*?(?=\/)/
type SelectorsObj = { [key: string]: [string, (e: Cheerio) => any] }

export const getElementObjFromParent = <T extends SelectorsObj>(
  $: CheerioStaticEx,
  parentSelector: string,
  selectorsObj: { [key: string]: [string, (e: Cheerio) => any] }
) =>
  $(parentSelector)
    .toArray()
    .map(v =>
      Object.keys(selectorsObj).reduce(
        (prev, cur) => ({
          [cur]: selectorsObj[cur][1]($(selectorsObj[cur][0], v).first()),
          ...prev
        }),
        {} as { [P in keyof T]: ReturnType<T[P][1]> }
      )
    )
export const getElementObj = <T extends SelectorsObj>(
  $: CheerioStaticEx,
  selectorsObj: T
) =>
  Object.keys(selectorsObj).reduce(
    (prev, cur) => ({
      [cur]: selectorsObj[cur][1]($(selectorsObj[cur][0])),
      ...prev
    }),
    {} as { [P in keyof T]: ReturnType<T[P][1]> | null }
  )

export const getrootUrl = (url: string) => url.match(absUrlReg)

export const getAllPages = async (
  client: ChildInstance,
  url: string,
  nextSelector: string
): Promise<CheerioStaticEx[]> => {
  let $: CheerioStaticEx = await RxFetch(client, url).toPromise(),
    nextUrl = $(nextSelector)
      .first()
      .attr('href')
  const $arr = [$]

  while (nextUrl) {
    nextUrl = urlPath.resolve(url, nextUrl)
    $ = await RxFetch(client, nextUrl).toPromise()
    $arr.push($)

    nextUrl = $(nextSelector)
      .first()
      .attr('href')
  }

  return $arr
}
export const getAllPagesRx = (
  client: ChildInstance,
  url: string,
  nextSelector: string,
  f?: (selector: Cheerio) => string
): Observable<CheerioStaticEx> =>
  RxFetch(client, url).pipe(
    expand($ => {
      const $next = $(nextSelector).first()
      const relativeUrl = f ? f($next) : $next.attr('href')
      if (!relativeUrl || /javascript/i.exec(relativeUrl)) {
        return empty()
      }
      const nextUrl = urlPath.resolve(url, relativeUrl)

      return relativeUrl ? RxFetch(client, nextUrl) : empty()
    })
  )
