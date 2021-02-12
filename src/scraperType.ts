import { Observable } from 'rxjs'
import { CheerioStaticEx } from 'cheerio-httpcli'
import List from './lists'
export abstract class Scraper {
  protected isItaly: boolean
  constructor(protected argv: any[], protected lists: List) {
    this.isItaly = argv[3] && argv[3] === 'italy'
  }
  abstract beforeFetchPages: (url: string) => Observable<any>
  abstract NEXT_SELECTOR: string
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
    price: string
    old_price: string
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
  }>
}
