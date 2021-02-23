import * as path from 'path'
import * as fs from 'fs-extra'
import * as archiver from 'archiver'

class Zipper {
  private output: fs.WriteStream
  private archive: archiver.Archiver
  constructor(saveTo: string) {
    this.output = fs.createWriteStream(saveTo)
    this.archive = archiver('zip')
    this.archive.pipe(this.output)
  }

  writeFile(data: Buffer | fs.ReadStream, filename: string) {
    this.archive.append(data, { name: filename })
  }

  finalize() {
    return new Promise((resolve, reject) => {
      this.output.on('close', resolve)
      this.archive.finalize().catch(err => reject(err))
    })
  }
}

const zipper = new Zipper(path.join(__dirname, '../data/test.zip'))
const dirname = path.join(__dirname, '../data/img')
fs.readdir(dirname)
  .then(lists =>
    Promise.all(
      lists.map(name =>
        fs
          .readFile(path.join(dirname, name))
          .then(buf => zipper.writeFile(buf, name))
      )
    )
  )
  .then(() => zipper.finalize())
  .then(() => {
    process.exit()
  })
  .catch(err => console.log(err))
