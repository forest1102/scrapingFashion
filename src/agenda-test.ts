import { execScrape } from './scrapers/index'
import * as moment from 'moment'
import { SpreadSheet, CloudStorage } from './saver'
import * as Agenda from 'agenda'
import * as _ from 'lodash'
import * as archiver from 'archiver'
import * as path from 'path'
import { v1 as uuid } from 'uuid'
import * as fs from 'fs-extra'

const agenda = new Agenda({
  db: { address: 'mongodb://127.0.0.1:27017/agenda' }
})
const agendaNames = Object.freeze({
  zipFiles: 'zip-files',
  execScrape: 'exec-scrape',
  updateSchedule: 'update-schedule'
} as const)

agenda.define(agendaNames.zipFiles, { concurrency: 1 }, async (job, done) => {
  const localFilename = path.join(__dirname, '../data/', uuid() + '.zip')
  let saveTo = job.attrs.data.saveTo as string
  if (!saveTo.endsWith('/')) saveTo += '/'
  try {
    console.log('zip files from: ', saveTo)
    const storage = new CloudStorage()
    const [files] = await storage.listFiles(saveTo)
    const localSaver = fs.createWriteStream(localFilename)
    localSaver.on('close', () => {
      storage
        .uploadFrom(localFilename, path.join(saveTo.slice(0, -1) + '.zip'))
        .then(() => fs.unlink(localFilename))
        .then(() => storage.deleteFolder(saveTo))
        .then(() => done())
        .catch(done)
    })
    const zipper = archiver('zip', {
      zlib: {
        level: 9
      }
    })
    zipper.on('warning', function(err) {
      if (err.code === 'ENOENT') {
        // log warning
        console.log(err)
      } else {
        // throw error
        fs.unlink(localFilename)
          .then(() => done(err))
          .catch(() => done(Error('unable to delete')))
      }
    })
    zipper.pipe(localSaver)
    for (let i = 0, len = files.length; i < len; ++i) {
      const name = files[i].name.slice(saveTo.length)
      zipper.append(
        files[i].createReadStream().on('end', () => {
          console.log(`${i} / ${len} zipped: `, name)
        }),
        {
          name
        }
      )
    }
    await zipper.finalize()
    console.log('zip finalized')
  } catch (e) {
    console.log(e)
    await fs.unlink(localFilename).catch(e => done(e))
  }
})
agenda.define('exec-scrape', { concurrency: 1 }, async (job, done) => {
  const spreadsheet = new SpreadSheet(
    '1dtWIA9CLkzU_U_ujDtl-70UMb-KttUwGoMReStMXdv4'
  )

  const rowIdx = job.attrs.data.rowIdx as number
  const argv = job.attrs.data.argv as string[]
  if (!rowIdx || !argv) console.log('not defined')
  spreadsheet
    .updateCell('I' + rowIdx, [
      [moment().format('YYYY/MM/DD HH:mm:ss'), '', '']
    ])
    .then(() => {
      console.log('started', argv)
      execScrape(
        argv,
        (count, saveTo, err) => {
          return (err
            ? spreadsheet.updateCell('J' + rowIdx, [
                [
                  moment().format('YYYY/MM/DD HH:mm:ss'),
                  count,
                  err.message || JSON.stringify(err)
                ]
              ])
            : spreadsheet.updateCell('J' + rowIdx, [
                [moment().format('YYYY/MM/DD HH:mm:ss'), count]
              ])
          )
            .then(
              () =>
                saveTo &&
                job.agenda.schedule('in 60 seconds', agendaNames.zipFiles, {
                  saveTo
                })
            )
            .then(() => done())
        },
        count => {
          job
            .touch()
            .then(() =>
              count % 100 === 0
                ? spreadsheet.updateCell('K' + rowIdx, [[count]]).then(() => {})
                : Promise.resolve()
            )
            .catch(err => console.log(err))
        }
      )
    })
    .catch(err => {
      console.log(err)
      done()
    })
})
agenda.define('update-schedule', { priority: 'low' }, async (job, done) => {
  const atob = <T>(str: T) =>
    Buffer.from(JSON.stringify(str), 'utf8').toString('base64')
  const spreadsheet = new SpreadSheet(
    '1dtWIA9CLkzU_U_ujDtl-70UMb-KttUwGoMReStMXdv4'
  )
  const newSchedule: string[][] = await spreadsheet.getCells('A2:H')

  const scheduleToDel = _.reduce(
    await agenda.jobs({ name: agendaNames.execScrape }),
    (acc, cur) => ({ ...acc, [cur?.attrs?.data?.hash ?? 'none']: cur }),
    {} as { [key: string]: Agenda.Job }
  )

  console.log(Object.keys(scheduleToDel))

  for (const [idx, row] of newSchedule.entries()) {
    const hash = atob(row)
    const rule = [row[0], row[1], '*/' + row[2], '*', '*'].join(' ')
    const argv = ['', '', ...row.slice(3)]
    const rowIdx = idx + 2
    if (scheduleToDel[hash]) {
      delete scheduleToDel[hash]
    } else {
      const job = await agenda
        .create(agendaNames.execScrape, { hash, argv, rowIdx })
        .repeatEvery(rule, { timezone: 'Asia/Tokyo' })
        .save()
      console.log('schedule: ' + JSON.stringify(job.attrs, null, 2))
    }
  }
  for (const hash of Object.keys(scheduleToDel)) {
    console.log('delete schedule:', scheduleToDel[hash].attrs.data)
    await scheduleToDel[hash].remove()
  }
  done()
})
;(async function() {
  console.log('start agenda')

  async function graceful() {
    await agenda.stop()
    process.exit(0)
  }

  process.on('SIGTERM', graceful)
  process.on('SIGINT', graceful)
  await agenda.start()
  if (process.argv[2] == 'zip-files' && process.argv[3]) {
    await agenda.cancel({})
    await agenda.schedule('in 2 seconds', agendaNames.zipFiles, {
      saveTo: process.argv[3]
    })
  } else {
    if (process.argv[2] == 'cancel-all') {
      await agenda.cancel({})
    }
    await agenda.schedule('in 10 seconds', agendaNames.updateSchedule)
    await agenda.every('0 0 * * *', agendaNames.updateSchedule)
  }
})().catch(err => console.log(err))
