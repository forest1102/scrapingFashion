import { execScrape } from './scrapers'
import * as scheduler from 'node-schedule'
import { SpreadSheet } from './saver'
import * as moment from 'moment'
import * as _ from 'lodash'
const atob = <T>(str: T) =>
  Buffer.from(JSON.stringify(str), 'utf8').toString('base64')
async function init() {
  const currentSchedule = scheduler.scheduledJobs
  const spreadsheet = new SpreadSheet(
    '1dtWIA9CLkzU_U_ujDtl-70UMb-KttUwGoMReStMXdv4'
  )
  const newSchedule: string[][] = await spreadsheet.getCells('A2:H')

  console.log('new schedule: ', newSchedule)
  let scheduleToDel = { ...currentSchedule }
  delete scheduleToDel['daily-update']
  newSchedule.map((row, idx) => {
    const name = atob(row)
    const rule = [row[0], row[1], '*/' + row[2], '*', '*'].join(' ')
    const _argv = ['', '', ...row.slice(3)]
    if (name in currentSchedule) {
      delete scheduleToDel[name]
    } else {
      console.log('schedule: ' + name + ' is scheduled in ' + rule)
      scheduler.scheduleJob(
        name,
        rule,
        function(argv: string[], rowIdx: number) {
          console.log('schedule-' + rowIdx + ' start with: ' + argv.join(' '))
          spreadsheet
            .updateCell('I' + rowIdx, [
              [moment().format('YYYY/MM/DD HH:mm:ss')]
            ])
            .then(() => {
              console.log('started', argv)
              return execScrape(argv)
            })
            .catch(err => {
              return spreadsheet.updateCell('J' + rowIdx, [
                [moment().format('YYYY/MM/DD HH:mm:ss'), -1, err]
              ])
            })
            .catch(err => {
              console.log(err)
            })
        }.bind(null, _argv, idx + 2)
      )
    }
  })
  _.forEach(scheduleToDel, (job, name) => {
    console.log('schedule: ' + name + ' is canceled')
    scheduler.cancelJob(name)
  })
}

scheduler.scheduleJob('daily-update', '* */30 * * * ', () => {
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
