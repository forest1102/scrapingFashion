import { throwError, of } from 'rxjs'
import { delay, retryWhen, take, tap, concat, flatMap } from 'rxjs/operators'

export const retryWithDelay = (ms: number, count: number, catchError?: ((err: any) => void), excludedError: (string)[] = []) =>
  retryWhen(errors => errors.pipe(
    flatMap((err, i) =>
      (i >= count || excludedError.find(e => e == (err.statusCode || ''))) ?
        throwError(err) :
        of(err)
    ),
    tap(catchError || ((err) => {
      console.log(err)
      console.log('retry...')
    })),
    delay(ms),
    concat(throwError('retried too much...'))
  ))

export const retryWithRandomDelay = (min: number, max: number, count: number, catchError?: ((err: any) => void), excludedError: (string)[] = []) =>
  retryWithDelay(Math.random() * (max - min) + min, count, catchError, excludedError)

