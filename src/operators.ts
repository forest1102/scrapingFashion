import { throwError, of, pipe, interval } from 'rxjs'
import {
  delay,
  retryWhen,
  take,
  tap,
  concat,
  flatMap,
  delayWhen
} from 'rxjs/operators'

export const retryWithDelay = (
  ms: number,
  count: number,
  excludedError: string[] = []
) =>
  pipe(
    tap(null, err => console.log('err', err, 'retry...')),
    retryWhen(errors =>
      errors.pipe(
        flatMap((err, i) => {
          return i >= count ||
            excludedError.find(e => e == (err.statusCode || ''))
            ? throwError(err)
            : of(err)
        }),
        delay(ms),
        concat(throwError('Too Much Retry'))
      )
    )
  )

export const retryWithRandomDelay = (
  min: number,
  max: number,
  count: number,
  excludedError: string[] = []
) => retryWithDelay(Math.random() * (max - min) + min, count, excludedError)

export const randomDelay = (min: number, max: number) =>
  delayWhen(() => interval(Math.random() * (max - min) + min))
