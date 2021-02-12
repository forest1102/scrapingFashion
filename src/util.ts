import * as urlPath from 'url'
import * as moment from 'moment'
import * as _ from 'lodash'
import { Row } from 'exceljs'
import * as cookie from 'cookie'
export const commaToDot = (str?: string) => (str || '').replace(',', '.')

export const addBaseURL = (baseUrl: string) => (relUrl: string) =>
  urlPath.resolve(baseUrl, relUrl)

export const getLastWord = (str: string) => {
  const splited = str.split(' ')
  return splited[splited.length - 1]
}

export const getSurfaceText = (e: Cheerio) => {
  e.children().empty()
  return e.text()
}

export function* makeRingItr<T>(arr: T[]) {
  let i = 0
  while (true) {
    const a = arr[i]
    i = (i + 1) % arr.length
    yield a
  }
}

export const makeRegId = function* (id: string, start = 2) {
  let i = start
  const dayStr = moment().format('MMDD')

  while (true) {
    yield `${i++}${id}${dayStr}`
  }
}

export const ObjectToArray = <T>(
  toArrIndex: { [key: number]: string },
  obj: { [key: string]: T }
) =>
  _.reduce(
    toArrIndex,
    (acc, value, key) => {
      const curVal = obj[value]
      if (curVal instanceof Array) {
        acc[key] = curVal.join(',')
      } else if (_.isNil(curVal)) {
        acc[key] = ''
      } else {
        acc[key] = curVal
      }
      return acc
    },
    [] as Exclude<T, string[]>[]
  )

export const setBackground = (row: Row, cells: string[], color: string) =>
  cells.forEach(c => {
    row.getCell(c).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: color
      }
    }
  })

export const getBytes = (str: string) =>
  _.sumBy(str, c => (/[\x01-\x7Eｦ-ﾟｰ ]/.test(c) ? 1 : 2))

export const findByWords = (array: string[], str: string) => {
  const strWords = str.split(' ')
  const sLen = strWords.length
  return array.find(q => {
    const queryWords = q.split(' ')
    const qLen = queryWords.length
    return _.some(_.range(sLen - qLen + 1), i =>
      _.isMatch(strWords.slice(i, i + qLen), queryWords)
    )
  })
}

export const filterByWords = (map: { [key: string]: boolean }, str: string) => {
  const words = str.split(' ')
  const res: string[] = []
  const len = words.length
  for (let subLen = len; subLen > 0; --subLen) {
    for (let i = 0; i <= len - subLen; i++) {
      const subStr = words.slice(i, i + subLen).join(' ')
      if (subStr in map) {
        words.splice(i, subLen)
        res.push(subStr)
        subLen = words.length
      }
    }
  }
  return res
}

const size = {
  'XS': 0,
  'S': 1,
  'M': 2,
  'L': 3,
  'XL': 4,
  '2XL': 5,
  '3XL': 6,
  '4XL': 7
}

export const sizeCompare = (a: string, b: string) =>
  isFinite(a as any) ? parseFloat(a) - parseFloat(b) : size[a] - size[b]

export function execAll(re: RegExp, str: string) {
  let arr: RegExpExecArray
  const res: RegExpExecArray[] = []
  while ((arr = re.exec(str)) !== null) {
    res.push(arr)
  }
  return res
}

export function* execAllGen(re: RegExp, str: string) {
  let arr: RegExpExecArray
  while ((arr = re.exec(str)) !== null) {
    yield arr
  }
}

export const updateCookie = (cookieStr: string, key: string, val: string) => {
  const obj = cookie.parse(cookieStr)
  if (val === undefined) delete obj[key]
  else obj[key] = val
  return _.reduce(
    obj,
    (acc, cur, curKey) => (acc ? acc + ';' : '') + `${curKey}=${cur}`,
    ''
  )
}

export const execIfNotEmpty = (str: string | null, f: (string) => string) =>
  str ? f(str) : ''

export const swapElement = <T>(array: T[], from: number, to: number) => {
  if (Math.abs(from) >= array.length || Math.abs(to) >= array.length)
    return array
  from += from < 0 ? array.length : 0
  to += to < 0 ? array.length : 0
  const tmpArr = [...array]
  const tmp = tmpArr[from]
  tmpArr[from] = tmpArr[to]
  tmpArr[to] = tmp
  return tmpArr
}

export const replaceWords = (
  str: string | string[],
  map: { [key: string]: string }
) => {
  const words = str instanceof Array ? str : str.split(' ')
  const len = words.length
  for (let subLen = words.length; subLen > 0; --subLen) {
    for (let i = 0; i <= len - subLen; i++) {
      const subStr = words.slice(i, i + subLen).join(' ')
      if (subStr in map) {
        words.splice(i, subLen, map[subStr])
        subLen = words.length
      }
    }
  }
  return words.join(' ')
}
