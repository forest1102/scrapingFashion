import { execScrape } from './scrapers'
import * as scheduler from 'node-schedule'
import * as fs from 'fs-extra'
import * as csv from 'csv-parse/lib/sync'
import * as Diff from 'diff'
import * as path from 'path'
import { SpreadSheet } from './saver'
import * as moment from 'moment'
import stringify = require('csv-stringify')
const LOCAL_SCHEDULE_PATH = path.join(__dirname, '../data/schedule.csv')
async function init() {
  const spreadsheet = new SpreadSheet(
    '1dtWIA9CLkzU_U_ujDtl-70UMb-KttUwGoMReStMXdv4'
  )
  const newSchedule: string[][] = await spreadsheet.getCells('A2:H')
  let localSchedule = csv(
    await fs.readFile(LOCAL_SCHEDULE_PATH).catch(err => ''),
    {
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      from: 2
    }
  ) as string[][]
  const diff = Diff.diffArrays(localSchedule, newSchedule, {})
  let id = 1
  diff.forEach((part, i) => {
    if (part.removed) {
      part.value.forEach((row, idx) => {
        console.log(`delete job schedule-${id + idx}`)
        scheduler.cancelJob(`schedule-${id + idx}`)
      })
    } else if (part.added) {
      part.value.forEach((row, idx) => {
        const rule = [row[0], row[1], '*/' + row[2], '*', '*'].join(' ')
        const argv = ['', '', ...row.slice(3)]

        const job = scheduler.scheduleJob(
          `schedule-${id + idx}`,
          rule,
          function (argv: string[]) {
            spreadsheet
              .updateCell('I' + (id + idx), [
                [moment().format('YYYY/MM/DD HH:mm:ss')]
              ])
              .then(() => {
                console.log('started', argv)
                execScrape(argv, count =>
                  spreadsheet.updateCell('J' + (id + idx), [
                    [moment().format('YYYY/MM/DD HH:mm:ss'), count]
                  ])
                )
              })
              .catch(err => console.log(err))
          }.bind(null, argv)
        )
        console.log('new job: ', job.name, rule)
      })
      id += part.count
    } else {
      id += part.count
    }
  })
  stringify(newSchedule, { delimiter: ',' }, (err, output) => {
    if (err) console.error(err)
    else
      fs.outputFile(LOCAL_SCHEDULE_PATH, output).catch(err =>
        console.error(err)
      )
  })
}

scheduler.scheduleJob('daily-update', '0 0 * * * ', () => {
  init()
    .then(() => console.log('success'))
    .catch(err => console.error('error'))
})
init()
  .then(() => console.log('success'))
  .catch(err => console.error('error'))
//   fs.readFile(path.join(__dirname, '../data/schedule.csv'))
//     .then(buf => csv(buf) as string[][])
//     .then(data => {
//       const row = data[0]
//       const rule = row.slice(0, 5).join(' ')
//       const argv = ['', '', ...row.slice(5)]
//       console.log(rule)

//       const job = scheduler.scheduleJob(
//         'test',
//         rule,
//         function (argv: string[]) {
//           console.log('started', argv)
//           execScrape(argv)
//         }.bind(null, argv)
//       )
//       console.log(job.name)
//     })

//     .catch(err => console.log(err))
// }
