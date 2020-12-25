import * as fs from 'fs-extra'
import * as path from 'path'


fs.readJSON(path.join(__dirname, '../data/data.json'))
  .then((arr: { name: string }[]) =>
    arr
      .map(v =>
        (v.name as string)
          .replace(/([A-Z])/g, ' $1')
          .trim()
          .toLowerCase()
      )

  )
  .then(arr => fs.outputJSON(path.join(__dirname, '../data/colors.json'), arr))
