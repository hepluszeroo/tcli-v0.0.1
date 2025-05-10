import { describe, it, expect, vi, beforeEach } from 'vitest'
import NDJSONParser from '../utils/codex_ndjson_parser'

/**
 * Comprehensive test suite for the NDJSON parser
 * Tests edge cases including chunked JSON, blank lines, line boundaries,
 * and error handling for oversized inputs
 */
describe('NDJSONParser', () => {
  let parser: NDJSONParser

  beforeEach(() => {
    parser = new NDJSONParser()
  })

  it('parses complete JSON lines', (done) => {
    parser.once('object', (obj) => {
      expect(obj).toEqual({ hello: 'world' })
      done()
    })
    parser.write('{"hello":"world"}\n')
  })

  it('reassembles split chunks', (done) => {
    parser.once('object', (obj) => {
      expect(obj).toEqual({ a: 1 })
      done()
    })
    parser.write('{"a"')
    parser.write(':1}\n')
  })

  it('handles CRLF newlines', (done) => {
    parser.once('object', (obj) => {
      expect(obj).toEqual({ ok: true })
      done()
    })
    parser.write('{"ok":true}\r\n')
  })

  it('emits rawLine on non-JSON', (done) => {
    parser.once('rawLine', (line) => {
      expect(line).toBe('not-json')
      done()
    })
    parser.write('not-json\n')
  })

  it('drops oversize lines', (done) => {
    const big = 'a'.repeat(1 * 1024 * 1024 + 10) // 1MiB + 10 bytes
    let errorEmitted = false
    parser.once('error', (err) => {
      expect(err.message).toMatch(/oversized|too\s*large/i)
      errorEmitted = true
    })
    parser.write(big + '\n')

    setTimeout(() => {
      expect(errorEmitted).toBe(true)
      done()
    }, 10)
  })

  it('handles blank lines between JSON objects', (done) => {
    const objects: any[] = []
    
    parser.on('object', (obj) => {
      objects.push(obj)
      if (objects.length === 2) {
        expect(objects[0]).toEqual({ first: true })
        expect(objects[1]).toEqual({ second: true })
        done()
      }
    })
    
    parser.write('{"first":true}\n\n{"second":true}\n')
  })

  it('strips UTF-8 BOM at the start of stream', (done) => {
    // Create a buffer with a UTF-8 BOM (byte order mark)
    const bomBuffer = Buffer.from([0xEF, 0xBB, 0xBF]) 
    const jsonBuffer = Buffer.from('{"bom":"stripped"}\n')
    const fullBuffer = Buffer.concat([bomBuffer, jsonBuffer])
    
    parser.once('object', (obj) => {
      expect(obj).toEqual({ bom: 'stripped' })
      done()
    })
    
    parser.write(fullBuffer)
  })

  it('handles multiple JSON objects in one write', (done) => {
    const objects: any[] = []
    
    parser.on('object', (obj) => {
      objects.push(obj)
      if (objects.length === 3) {
        expect(objects).toEqual([
          { id: 1 },
          { id: 2 },
          { id: 3 }
        ])
        done()
      }
    })
    
    parser.write('{"id":1}\n{"id":2}\n{"id":3}\n')
  })

  it('emits error when buffer capacity is exceeded', (done) => {
    // Create a parser with a tiny buffer capacity
    const tinyParser = new NDJSONParser({ bufferCapBytes: 20 })
    
    // Write data larger than the buffer capacity, without newlines
    tinyParser.once('error', (err) => {
      expect(err.message).toMatch(/buffer exceeded/i)
      done()
    })
    
    tinyParser.write('a'.repeat(30))
  })

  it('purges buffer after capacity error', (done) => {
    // Create a parser with a tiny buffer capacity
    const tinyParser = new NDJSONParser({ bufferCapBytes: 20 })
    
    // First exceed buffer capacity 
    tinyParser.write('a'.repeat(30))
    
    // Then write valid JSON
    tinyParser.once('object', (obj) => {
      expect(obj).toEqual({ valid: true })
      done()
    })
    
    // Should parse correctly after buffer purge
    setTimeout(() => {
      tinyParser.write('{"valid":true}\n')
    }, 10)
  })
})