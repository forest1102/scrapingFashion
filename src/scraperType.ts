import { Observable, of } from 'rxjs'
import { CheerioStaticEx, ChildInstance } from 'cheerio-httpcli'
import List from './lists'
import { getAllPagesRx } from '../src/observable'
export abstract class Scraper {
  constructor(
    protected lists: List,
    protected client: ChildInstance,
    protected isItaly: boolean,
    protected argv: string[]
  ) {}
  beforeFetchPages = (url: string) => of(url) as Observable<any>
  NEXT_SELECTOR?: string
  abstract toItemPageUrlObservable: (
    $: CheerioStaticEx,
    url: string
  ) => Observable<
    Observable<
      | string
      | {
          url: string
          others: { [key: string]: any }
        }
    >
  >

  abstract extractData(
    $: CheerioStaticEx,
    others: { [key: string]: string | number | boolean }
  ): Observable<{
    category_tree?: string
    brand: string
    productName: string
    price: string | { f: string }
    old_price: string | { f: string }
    size: string[]
    sku: string
    description: string
    category: string
    currency: string
    image: string[]
    season: string
    gender: 'WOMEN' | 'MEN' | string
    color: string[]
    size_chart: string
    size_info: string
    euro_price?: string | number
    show_discount?: boolean
  }>

  getAllPages = (url: string) =>
    getAllPagesRx(this.client, url, this.NEXT_SELECTOR)
}
