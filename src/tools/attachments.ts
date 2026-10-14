/**
 * Jira MCP Server - Attachment Tools
 *
 * Tools for viewing image attachments inline and uploading local files.
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { lookup } from 'mime-types';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { jiraDownloadAttachment, jiraGet, jiraPostForm, pathSegment } from '../client.js';
import { formatResponse } from '../config.js';
import { startToolCall, endToolCall, failToolCall } from '../logger.js';
import type { JiraAttachment, JiraIssue } from '../types.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024;

interface JiraIssueImage {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentUrl: string;
  data: string;
}

interface SkippedAttachment {
  id: string;
  filename: string;
  reason: string;
}

interface JiraIssueImagesResult {
  issueKey: string;
  images: JiraIssueImage[];
  skipped: SkippedAttachment[];
}

/**
 * Fetch image attachments from an issue through Jira's authenticated content
 * URLs. An attachment ID can be supplied to retrieve one specific image.
 */
export const getIssueImages = async (
  issueKey: string,
  attachmentId?: string,
  maxImages: number = 5
): Promise<JiraIssueImagesResult> => {
  const params = new URLSearchParams({ fields: 'attachment' });
  const issue = await jiraGet<JiraIssue>(`/issue/${pathSegment(issueKey)}?${params}`);
  const allAttachments = issue.fields.attachment || [];
  let attachments: JiraAttachment[];

  if (attachmentId) {
    const attachment = allAttachments.find(item => item.id === attachmentId);
    if (!attachment) {
      throw new Error(`Attachment ${attachmentId} was not found on issue ${issueKey}.`);
    }
    attachments = [attachment];
  } else {
    attachments = allAttachments
      .filter(item => item.mimeType.toLowerCase().startsWith('image/'))
      .slice(0, maxImages);
  }

  const images: JiraIssueImage[] = [];
  const skipped: SkippedAttachment[] = [];
  let totalImageBytes = 0;
  const skip = (attachment: JiraAttachment, reason: string) =>
    skipped.push({ id: attachment.id, filename: attachment.filename, reason });

  for (const attachment of attachments) {
    if (!attachment.mimeType.toLowerCase().startsWith('image/')) {
      skip(attachment, `Attachment MIME type is ${attachment.mimeType}, not an image.`);
      continue;
    }
    if (totalImageBytes + attachment.size > MAX_TOTAL_IMAGE_BYTES) {
      skip(attachment, 'Returning this image would exceed the 20 MiB total response limit.');
      continue;
    }

    try {
      const downloaded = await jiraDownloadAttachment(attachment.content, MAX_IMAGE_BYTES);

      if (!downloaded.mimeType.toLowerCase().startsWith('image/')) {
        skip(attachment, `Downloaded content type is ${downloaded.mimeType}, not an image.`);
        continue;
      }
      if (totalImageBytes + downloaded.size > MAX_TOTAL_IMAGE_BYTES) {
        skip(attachment, 'Returning this image would exceed the 20 MiB total response limit.');
        continue;
      }

      images.push({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: downloaded.mimeType,
        size: downloaded.size,
        contentUrl: downloaded.url,
        data: downloaded.data,
      });
      totalImageBytes += downloaded.size;
    } catch (err) {
      skip(attachment, err instanceof Error ? err.message : String(err));
    }
  }

  return { issueKey, images, skipped };
};

/**
 * Upload a local file as an attachment to a Jira issue.
 */
export const uploadAttachment = async (
  issueKey: string,
  filePath: string
): Promise<JiraAttachment[]> => {
  if (!isAbsolute(filePath)) {
    throw new Error('filePath must be an absolute path on the MCP server host.');
  }

  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) {
    throw new Error(`Attachment path is not a regular file: "${filePath}"`);
  }

  const content = await readFile(filePath);
  const filename = basename(filePath);
  // Jira stores the part's MIME type; without it images are saved as octet-stream
  const mimeType = lookup(filename) || 'application/octet-stream';
  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(content)], { type: mimeType }), filename);

  return jiraPostForm<JiraAttachment[]>(
    `/issue/${pathSegment(issueKey)}/attachments`,
    formData
  );
};

/**
 * Register attachment tools with the MCP server.
 */
export const registerAttachmentTools = (server: McpServer): void => {
  // Get issue images
  server.tool(
    'jira_get_issue_images',
    'Get image attachments from a Jira issue as inline MCP image content. Uses Jira\'s authenticated attachment URLs, so the client does not need a separate browser login. Optionally provide an attachment ID to retrieve one specific image.',
    {
      issueKey: z.string().describe('Issue key (e.g., KP-123)'),
      attachmentId: z.string().optional().describe('Specific attachment ID to retrieve (from jira_get_issue attachments)'),
      maxImages: z.coerce.number().min(1).max(10).default(5).describe('Maximum images to return when attachmentId is omitted'),
    },
    async (args) => {
      const callLog = startToolCall('jira_get_issue_images', args);
      try {
        const result = await getIssueImages(args.issueKey, args.attachmentId, args.maxImages);
        const summary = {
          issueKey: result.issueKey,
          imageCount: result.images.length,
          images: result.images.map(({ data: _data, ...metadata }) => metadata),
          skipped: result.skipped,
        };

        endToolCall(callLog, summary);
        return {
          content: [
            { type: 'text' as const, text: formatResponse(summary) },
            ...result.images.map(image => ({
              type: 'image' as const,
              data: image.data,
              mimeType: image.mimeType,
            })),
          ],
        };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );

  // Upload attachment
  server.tool(
    'jira_upload_attachment',
    'Upload a local file as an attachment to an existing Jira issue. The filePath must be an absolute path readable by the MCP server host. Any file type is supported; Jira enforces its own size and permission limits.',
    {
      issueKey: z.string().min(1).describe('Issue key (e.g., KP-123) or numeric issue ID'),
      filePath: z.string().min(1).describe('Absolute path to the local file on the MCP server host'),
    },
    async (args) => {
      const callLog = startToolCall('jira_upload_attachment', args);
      try {
        const attachments = await uploadAttachment(args.issueKey, args.filePath);
        endToolCall(callLog, attachments);
        return { content: [{ type: 'text', text: formatResponse(attachments) }] };
      } catch (err) {
        failToolCall(callLog, err);
        throw err;
      }
    }
  );
};
