import * as urlPath from 'url'
export const commaToDot = (str?: string) =>
  (str || '')
    .replace(',', '.')

export const addBaseURL = (baseUrl: string) =>
  (relUrl: string) =>
    urlPath.resolve(baseUrl, relUrl)

export function execAll(re: RegExp, str: string) {
  let arr: RegExpExecArray
  const res: RegExpExecArray[] = []
  while ((arr = re.exec(str)) !== null) {
    res.push(arr)
  }
  return res
}