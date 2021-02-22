import * as fs from 'fs'
import * as csv from 'csv-parse/lib/sync'
import { Options } from 'csv-parse'
import * as _ from 'lodash'
import { CloudStorage } from './saver'

export default class List {
  constructor(private storage: CloudStorage) {}
  makeBrandItr = () => {
    const counterObj: { [key: string]: number } = {}

    return (brand: string) => {
      if (!(brand in this.brandNameConverter)) return brand
      counterObj[brand] = counterObj[brand] || 0
      const brand_pro = this.brandNameConverter[brand][counterObj[brand]]
      counterObj[brand] =
        (counterObj[brand] + 1) % this.brandNameConverter[brand].length
      return brand_pro
    }
  }

  parseCSVFromFile = (name: string, options: Options = {}) =>
    this.storage.readFile(name).then(data =>
      csv(data[0], {
        skip_empty_lines: true,
        trim: true,
        ...options
      })
    )
  categoryConverter: {
    [key: string]: {
      big_category: string
      small_category: string
      tag: string
    }
  }
  brandNameConverter: {
    [key: string]: string[]
  }
  brandConverter: {
    [key: string]: string
  }
  colorConverter: { before: string; after: string }[]
  titleConverter: {
    [key: string]: string
  }
  brandTemplateConverter: {
    [key: string]: string
  }
  sizeConverter: {
    [size_chart: string]: {
      [before: string]: string
    }
  }
  marks: string[]
  supConverter: {
    [key: string]: string
  }
  catchWords: string[]
  priceMasterConverter: {
    [key: string]: {
      price_pro_formula: string
      price_ref_formula: string
      duty: string
      price_target_formula: string
      discount: number
      set_val: number
      postage: number
      exchange_rate: number
    }
  }
  seasonConverter: { [key: string]: { 'season 1': string; 'season 2': string } }
  headers: string[]
  categories: string[]
  colors: string[]
  colorMap: { [key: string]: boolean }
  shoes: string[]
  AHsize: { [key: string]: { 'shoes': string; 'not shoes': string } }
  urls: string[]
  constants: {
    '発送手段': string
    '購入期限': string
    '買付地': string
    '発送地': string
    '出品': string
    'テーマ': string
    '数量': string
    '管理番号': string
    '※購入者の支払方法': string
    '買付先ショップ名': string
    '関税': '関税元払い'
  }

  async loadFiles() {
    this.categoryConverter = _.reduce(
      await this.parseCSVFromFile('mapping_table/category_converter.csv', {
        columns: true
      }),
      (acc, { before, ...others }) => ({
        ...acc,
        [before]: others
      }),
      {}
    )
    this.brandNameConverter = _.reduce(
      await this.parseCSVFromFile('mapping_table/brand_name_converter.csv', {
        columns: true
      }),
      (acc, { before, after }) => ({
        ...acc,
        [before]: acc[before] ? [...acc[before], after] : [after]
      }),
      {}
    )

    this.brandConverter = _.reduce(
      (await this.parseCSVFromFile('mapping_table/brand_converter.csv', {
        columns: true
      })) as { before: string; after: string }[],
      (acc, { before, after }) => ({
        ...acc,
        [before]: after
      }),
      {}
    )

    this.colorConverter = await this.parseCSVFromFile(
      'mapping_table/color_converter.csv',
      {
        columns: true,
        cast: (v, context) => (context.column === 'before' ? _.upperCase(v) : v)
      }
    )

    this.titleConverter = _.reduce(
      (await this.parseCSVFromFile('mapping_table/title_converter.csv', {
        columns: true
      })) as { before: string; after: string }[],
      (acc, { before, after }) => ({
        ...acc,
        [before]: after
      }),
      {} as { [key: string]: string }
    )

    this.brandTemplateConverter = _.reduce(
      (await this.parseCSVFromFile(
        'mapping_table/brand_template_converter.csv',
        {
          columns: true
        }
      )) as { before: string; after: string }[],
      (acc, { before, after }) => ({
        ...acc,
        [before]: after
      }),
      {} as { [key: string]: string }
    )

    this.sizeConverter = _.reduce(
      (await this.parseCSVFromFile(
        'mapping_table/size_template_converter.csv',
        {
          columns: true
        }
      )) as { size_chart: string; before: string; after: string }[],
      (acc, { size_chart, before, after }) =>
        _.mergeWith(acc, { [size_chart]: { [before]: after } }, (a, b) =>
          _.isObject(a) ? { ...a, ...b } : undefined
        ),
      {} as { [size_chart: string]: { [before: string]: string } }
    )

    this.supConverter = _.reduce(
      (await this.parseCSVFromFile('mapping_table/supplement_converter.csv', {
        columns: true
      })) as { keyword: string; supplementation: string }[],
      (acc, { keyword, supplementation }) => ({
        ...acc,
        [keyword]: supplementation
      }),
      {} as { [key: string]: string }
    )

    this.catchWords = _.map(
      (await this.parseCSVFromFile('mapping_table/catch_word.csv', {
        columns: true
      })) as { catch_word: string }[],
      ({ catch_word }) => catch_word
    )

    this.marks = _.map(
      (await this.parseCSVFromFile('mapping_table/mark.csv', {
        columns: true
      })) as { catch_word: string; [key: string]: string }[],
      ({ mark }) => mark
    )

    this.priceMasterConverter = _.reduce(
      (await this.parseCSVFromFile('mapping_table/price_master_converter.csv', {
        columns: true,
        cast: true
      })) as {
        brand: string
        price_pro_formula: string
        price_ref_formula: string
        duty: string
        price_target_formula: string
        discount: number
        set_val: number
        postage: number
        exchange_rate: number
      }[],
      (acc, { brand, ...val }) => ({
        ...acc,
        [brand]: val
      }),
      {
        '': {
          price_pro_formula: '',
          price_ref_formula: '',
          duty: '0',
          price_target_formula: '',
          discount: 0,
          set_val: 0,
          postage: 0,
          exchange_rate: 0
        }
      }
    )

    this.seasonConverter = _.reduce(
      (await this.parseCSVFromFile('mapping_table/season_converter.csv', {
        columns: true
      })) as { 'keyword': string; 'season 1': string; 'season 2': string }[],
      (acc, { keyword, ...val }) => ({
        ...acc,
        [keyword]: val
      }),
      {
        '': {
          'season 1': '',
          'season 2': ''
        }
      }
    )

    this.headers = _.flatten(
      (await this.parseCSVFromFile('headers.csv')) as string[][]
    )

    this.categories = _.flatten(
      (await this.parseCSVFromFile('categories.csv')) as string[][]
    )

    this.colors = _.map(
      _.flatten((await this.parseCSVFromFile('colors.csv')) as string[][]),
      _.upperCase
    )

    this.colorMap = _.chain(
      (await this.parseCSVFromFile('colors.csv')) as string[][]
    )
      .flatten()
      .reduce(
        (acc, cur) => ({ ...acc, [_.upperCase(cur)]: true }),
        {} as { [key: string]: true }
      )
      .value()

    this.shoes = _.flatten(
      (await this.parseCSVFromFile('shoes.csv')) as string[][]
    )

    this.AHsize = _.keyBy(
      (await this.parseCSVFromFile('AHsize.csv', { columns: true })) as {
        'Brand': string
        'not shoes': string
        'shoes': string
      }[],
      'Brand'
    )

    this.urls = JSON.parse(
      (await this.storage.readFile('urls.json'))[0].toString()
    )

    this.constants = JSON.parse(
      (await this.storage.readFile('constants.json'))[0].toString()
    )
  }
  static readonly toArrIndex = Object.freeze({
    0: 'URL',
    1: 'category',
    2: 'category_tree',
    3: 'brand',
    4: 'productName',
    5: 'imgfile1',
    6: 'imgfile2',
    7: 'imgfile3',
    8: 'imgfile4',
    9: 'imgfile5',
    10: 'color',
    11: 'size',
    28: 'brand_sex',
    29: 'price',
    30: 'old_price',
    31: 'country',
    32: 'size_info',
    33: 'size_chart',
    34: 'description',
    35: 'season',
    36: 'sku',
    37: 'update',
    38: 'imgfile6',
    39: 'imgfile7',
    40: 'imgfile8',
    41: 'imgfile9',
    42: 'imgfile10',
    45: 'price',
    47: 'euro_price',
    52: 'URL',
    55: 'currency',
    83: 'img1',
    84: 'img2',
    85: 'img3',
    86: 'img4',
    87: 'img5',
    88: 'img6',
    89: 'img7',
    90: 'img8',
    91: 'img9',
    93: 'productName',
    94: 'productName'
  })

  static readonly toProcessedIndex: { [key: number]: string } = Object.freeze({
    ...List.toArrIndex,
    1: 'big_category',
    2: 'small_category',
    3: 'brand_pro',
    4: 'title_pro',
    10: 'color_pro',
    11: 'size_pro',
    12: 'sup',
    13: 'comment',
    14: 'theme',
    15: 'season 1',
    16: 'price_pro',
    17: 'shipping',
    18: 'amount',
    19: 'buy_lim',
    20: 'shop_id',
    21: 'deliver_id',
    22: 'auction',
    25: 'tag',
    26: 'payment',
    27: 'reg_id',
    42: 'price_pro',
    43: 'price_ref',
    44: 'tariff',
    45: 'price',
    46: 'price_target',
    48: 'discount',
    49: 'set_val',
    50: 'postage',
    51: 'supplier',
    54: 'exchange_rate',
    94: 'title',
    95: 'brand_temp_pro',
    96: 'brand_name',
    97: 'catch_word',
    98: 'season 2',
    99: 'mark',
    101: 'word_count'
  })
  static readonly toOutputIndex = Object.freeze({
    ...List.toProcessedIndex,
    0: 'gender',
    4: 'title_pro_val',
    13: 'comment_val',
    101: 'word_count_val'
  })
}
