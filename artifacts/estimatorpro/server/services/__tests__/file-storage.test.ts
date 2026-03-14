/**
 * ══════════════════════════════════════════════════════════════════════════════
 *  FILE STORAGE SERVICE — Test Suite
 *  Tests: static methods, file operations, interface compliance
 *  All fs/crypto calls are mocked to avoid real filesystem I/O.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { FileStorageService, FileStorageResult } from '../file-storage';

// ─── Mock fs ─────────────────────────────────────────────────────────────────
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
  renameSync: jest.fn(),
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
  statSync: jest.fn(),
}));

// ─── Mock crypto ─────────────────────────────────────────────────────────────
jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('abc123hash'),
  })),
}));

// ═══════════════════════════════════════════════════════════════════════════════
//  TEST DATA
// ═══════════════════════════════════════════════════════════════════════════════

const mockFile: Express.Multer.File = {
  fieldname: 'file',
  originalname: 'floor-plan.pdf',
  encoding: '7bit',
  mimetype: 'application/pdf',
  size: 102400,
  destination: '/tmp/uploads',
  filename: 'tmp-12345',
  path: '/tmp/uploads/tmp-12345',
  buffer: Buffer.from(''),
  stream: null as any,
};

const PROJECT_ID = 'proj-001';
const DOCUMENT_ID = 'doc-001';

// ═══════════════════════════════════════════════════════════════════════════════
//  FileStorageResult interface compliance
// ═══════════════════════════════════════════════════════════════════════════════

describe('FileStorageResult interface', () => {
  test('interface has expected shape', () => {
    const result: FileStorageResult = {
      storagePath: '/uploads/projects/proj-001/file.pdf',
      fileHash: 'abc123',
      relativePath: 'projects/proj-001/file.pdf',
    };
    expect(result.storagePath).toContain('proj-001');
    expect(result.fileHash).toBe('abc123');
    expect(result.relativePath).toContain('projects');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FileStorageService — static methods
// ═══════════════════════════════════════════════════════════════════════════════

describe('FileStorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LOCAL_STORAGE_DIR;
  });

  // ─── saveFile ───────────────────────────────────────────────────────────────

  describe('saveFile', () => {
    test('reads file, hashes, creates directory, and moves file', async () => {
      const fileData = Buffer.from('pdf-content');
      (fs.readFileSync as jest.Mock).mockReturnValue(fileData);

      const result = await FileStorageService.saveFile(mockFile, PROJECT_ID, DOCUMENT_ID);

      expect(fs.readFileSync).toHaveBeenCalledWith(mockFile.path);
      expect(crypto.createHash).toHaveBeenCalledWith('sha256');
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join('projects', PROJECT_ID, 'documents', DOCUMENT_ID, 'revisions')),
        { recursive: true },
      );
      expect(fs.renameSync).toHaveBeenCalled();

      expect(result.fileHash).toBe('abc123hash');
      expect(result.storagePath).toContain(PROJECT_ID);
      expect(result.relativePath).toContain('projects');
      expect(result.relativePath).toContain(PROJECT_ID);
      expect(result.relativePath).toContain(DOCUMENT_ID);
    });

    test('sanitizes the original filename', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from(''));
      const specialFile = { ...mockFile, originalname: 'my file (v2).pdf' };

      const result = await FileStorageService.saveFile(specialFile, PROJECT_ID, DOCUMENT_ID);

      // The filename should have special chars replaced with underscores
      expect(result.relativePath).toContain('my_file__v2_.pdf');
    });

    test('uses default storage dir when env not set', async () => {
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from(''));

      await FileStorageService.saveFile(mockFile, PROJECT_ID, DOCUMENT_ID);

      const mkdirCall = (fs.mkdirSync as jest.Mock).mock.calls[0][0];
      expect(mkdirCall).toContain('uploads');
    });

    test('uses LOCAL_STORAGE_DIR env variable when set', async () => {
      process.env.LOCAL_STORAGE_DIR = '/custom/storage';
      (fs.readFileSync as jest.Mock).mockReturnValue(Buffer.from(''));

      await FileStorageService.saveFile(mockFile, PROJECT_ID, DOCUMENT_ID);

      const mkdirCall = (fs.mkdirSync as jest.Mock).mock.calls[0][0];
      expect(mkdirCall).toContain('/custom/storage');
    });
  });

  // ─── getFilePath ────────────────────────────────────────────────────────────

  describe('getFilePath', () => {
    test('joins storage dir with relative path', () => {
      const relativePath = 'projects/proj-001/documents/doc-001/revisions/file.pdf';
      const result = FileStorageService.getFilePath(relativePath);
      expect(result).toContain('uploads');
      expect(result).toContain(relativePath);
    });

    test('respects LOCAL_STORAGE_DIR env', () => {
      process.env.LOCAL_STORAGE_DIR = '/data/files';
      const result = FileStorageService.getFilePath('test/file.pdf');
      expect(result).toContain('/data/files');
    });
  });

  // ─── fileExists ─────────────────────────────────────────────────────────────

  describe('fileExists', () => {
    test('returns true when file exists', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      expect(FileStorageService.fileExists('some/path.pdf')).toBe(true);
      expect(fs.existsSync).toHaveBeenCalled();
    });

    test('returns false when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(FileStorageService.fileExists('missing/path.pdf')).toBe(false);
    });
  });

  // ─── deleteFile ─────────────────────────────────────────────────────────────

  describe('deleteFile', () => {
    test('deletes existing file and returns true', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockReturnValue(undefined);

      expect(FileStorageService.deleteFile('some/file.pdf')).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    test('returns false when file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      expect(FileStorageService.deleteFile('missing.pdf')).toBe(false);
    });

    test('returns false and logs error on failure', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.unlinkSync as jest.Mock).mockImplementation(() => {
        throw new Error('permission denied');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(FileStorageService.deleteFile('locked.pdf')).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ─── getFileStats ───────────────────────────────────────────────────────────

  describe('getFileStats', () => {
    test('returns stats for existing file', () => {
      const mockStats = { size: 1024, isFile: () => true } as unknown as fs.Stats;
      (fs.statSync as jest.Mock).mockReturnValue(mockStats);

      const stats = FileStorageService.getFileStats('some/file.pdf');
      expect(stats).not.toBeNull();
      expect(stats!.size).toBe(1024);
    });

    test('returns null when file not found', () => {
      (fs.statSync as jest.Mock).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(FileStorageService.getFileStats('missing.pdf')).toBeNull();
    });
  });
});
