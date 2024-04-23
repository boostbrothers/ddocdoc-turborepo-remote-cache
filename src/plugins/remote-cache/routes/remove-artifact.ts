import type { Server } from 'http'
import type {
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RouteOptions,
} from 'fastify'
import { querystring, type Params, type Querystring } from './schema.js'

import * as fs from 'fs'
import * as path from 'path'
import { promisify } from 'util'

const readdir = promisify(fs.readdir)
const stat = promisify(fs.stat)
const unlink = promisify(fs.unlink)

function getFileList(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath)
  const fileList = entries.map((entry) => path.join(dirPath, entry))
  return fileList
}

async function getDirectorySize(directory: string): Promise<number> {
  const fileNames = await readdir(directory)
  let size = 0

  for (const fileName of fileNames) {
    const filePath = path.join(directory, fileName)
    const fileStat = await stat(filePath)
    size += fileStat.size
  }

  return size
}

async function deleteOldestFiles(
  directory: string,
  maxSize: number,
): Promise<void> {
  const fileNames = await readdir(directory)

  const files = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.join(directory, fileName)
      const fileStat = await stat(filePath)
      return { fileName: filePath, mtime: fileStat.mtime }
    }),
  )

  files.sort((a, b) => a.mtime.getTime() - b.mtime.getTime())

  for (const file of files) {
    await unlink(file.fileName)
    console.log(`Deleted file ${file.fileName}`)

    if ((await getDirectorySize(directory)) < maxSize) {
      break
    }
  }
}

async function maintainDirectorySize(
  directory: string,
  maxSizeInMB: number,
): Promise<void> {
  const maxSize = maxSizeInMB * 1024 * 1024 // Convert MB to bytes
  const directorySize = await getDirectorySize(directory)

  if (directorySize > maxSize) {
    await deleteOldestFiles(directory, maxSize)
  }
}

export const removeArtifact: RouteOptions<
  Server,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  {
    Querystring: Querystring
    Params: Params
  }
> = {
  url: '/artifacts',
  method: 'DELETE',
  exposeHeadRoute: true,
  schema: { querystring },
  async handler(req, reply) {
    try {
      const teamId = req.query.teamId ?? req.query.slug
      const mb = req.query.mb ?? 1024
      const directoryPath = `/tmp/${teamId}`
      await maintainDirectorySize(directoryPath, mb)
      reply.code(200).send(getFileList(directoryPath))
    } catch (err) {
      reply.code(400).send({ err })
    }
  },
}
