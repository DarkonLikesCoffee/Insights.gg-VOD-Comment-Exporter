(() => {
  'use strict';

  const COMMENTS_QUERY_HASH =
    '3b29e56a1a9e89010b979b3c2956774819afdfefbe796e3fe3ad911dde33fb74';

  const REPLIES_QUERY_HASH =
    '933d5164c718da565042472ab80d8f6b752c80b20d47b2b4668303814a854844';

  /*
   * ---------------------------------------------------------
   * Utility
   * ---------------------------------------------------------
   */

  function getVideoIdFromUrl() {

    const match =
      window.location.pathname.match(
        /\/video\/([a-zA-Z0-9]+)\//
      );

    return match
      ? match[1]
      : null;
  }

  /*
   * IMPORTANT:
   * This was accidentally missing in the previous version.
   */

  function fmtTime(seconds) {

    seconds =
      Math.floor(
        seconds || 0
      );

    const h =
      Math.floor(
        seconds / 3600
      );

    const m =
      Math.floor(
        (seconds % 3600) / 60
      );

    const s =
      seconds % 60;

    const pad =
      n =>
        String(n).padStart(
          2,
          '0'
        );

    if (h > 0) {

      return (
        `${h}:` +
        `${pad(m)}:` +
        `${pad(s)}`
      );

    }

    return (
      `${m}:` +
      `${pad(s)}`
    );
  }

  /*
   * ---------------------------------------------------------
   * GraphQL
   * ---------------------------------------------------------
   */

  async function postPersistedQuery(
    operationName,
    variables,
    sha256Hash
  ) {

    const response =
      await fetch(
        'https://insights.gg/graphql',
        {
          method: 'POST',

          headers: {
            'content-type':
              'application/json',

            accept: '*/*'
          },

          body:
            JSON.stringify([
              {
                operationName,
                variables,

                extensions: {
                  persistedQuery: {
                    version: 1,
                    sha256Hash
                  }
                }
              }
            ]),

          credentials: 'include',
          mode: 'cors'
        }
      );

    if (!response.ok) {

      throw new Error(
        `Request failed: ${response.status}`
      );

    }

    const json =
      await response.json();

    const payload =
      Array.isArray(json)
        ? json[0]
        : json;

    if (
      payload?.errors?.length &&
      !payload.data
    ) {

      throw new Error(
        payload.errors[0].message ||
        'GraphQL request failed.'
      );

    }

    if (!payload?.data) {

      throw new Error(
        'Unexpected response: no GraphQL data.'
      );

    }

    return payload.data;
  }

  function findVideoCommentsArray(
    obj
  ) {

    if (Array.isArray(obj)) {

      const comments =
        obj.filter(
          item =>
            item &&
            item.__typename ===
              'VideoComment'
        );

      if (comments.length) {
        return comments;
      }

      for (
        const item of obj
      ) {

        const found =
          findVideoCommentsArray(
            item
          );

        if (found) {
          return found;
        }

      }

      return null;
    }

    if (
      obj &&
      typeof obj === 'object'
    ) {

      for (
        const key of
          Object.keys(obj)
      ) {

        const found =
          findVideoCommentsArray(
            obj[key]
          );

        if (found) {
          return found;
        }

      }

    }

    return null;
  }

  async function fetchComments(
    videoId,
    limit
  ) {

    const data =
      await postPersistedQuery(
        'GetVideoCommentsQuery',
        {
          videoId,
          limit
        },
        COMMENTS_QUERY_HASH
      );

    const comments =
      findVideoCommentsArray(
        data
      );

    if (!comments) {

      throw new Error(
        'Could not locate comments array.'
      );

    }

    return comments;
  }

  async function fetchReplies(
    videoId,
    commentId,
    limit
  ) {

    const data =
      await postPersistedQuery(
        'GetCommentRepliesQuery',
        {
          videoId,
          commentId,
          limit
        },
        REPLIES_QUERY_HASH
      );

    const replies =
      data?.video
        ?.comment
        ?.queryReplies
        ?.replies;

    if (!Array.isArray(replies)) {

      throw new Error(
        `Could not locate replies for ${commentId}.`
      );

    }

    return replies;
  }

  async function attachReplies(
    videoId,
    comments
  ) {

    const result = [];

    for (
      const comment of comments
    ) {

      const replies =
        comment.replyCount > 0
          ? await fetchReplies(
              videoId,
              comment.id,
              Math.max(
                10,
                comment.replyCount
              )
            )
          : [];

      result.push({
        ...comment,
        _replies:
          replies
      });

    }

    return result;
  }

  /*
   * ---------------------------------------------------------
   * Draft.js parsing
   * ---------------------------------------------------------
   */

  function parseMessage(
    message
  ) {

    let parsed;

    try {

      parsed =
        JSON.parse(
          message
        );

    } catch {

      return {
        type: 'raw',
        text:
          message || ''
      };

    }

    if (
      !parsed ||
      !Array.isArray(
        parsed.blocks
      )
    ) {

      return {
        type: 'raw',
        text:
          message || ''
      };

    }

    return {
      type: 'draft',
      blocks:
        parsed.blocks
    };
  }

  function getBlockType(
    block
  ) {

    switch (
      block.type
    ) {

      case 'header-one':
        return 'h1';

      case 'header-two':
        return 'h2';

      case 'header-three':
        return 'h3';

      case 'header-four':
        return 'h4';

      case 'header-five':
        return 'h5';

      case 'header-six':
        return 'h6';

      case 'unordered-list-item':
        return 'ul';

      case 'ordered-list-item':
        return 'ol';

      case 'blockquote':
        return 'blockquote';

      default:
        return 'paragraph';
    }
  }

  function getStyleRanges(
    text,
    ranges
  ) {

    if (
      !ranges ||
      ranges.length === 0
    ) {

      return [
        {
          text,
          styles: []
        }
      ];

    }

    const points =
      new Set([
        0,
        text.length
      ]);

    ranges.forEach(
      range => {

        points.add(
          range.offset
        );

        points.add(
          range.offset +
            range.length
        );

      }
    );

    const sorted =
      [...points].sort(
        (a, b) =>
          a - b
      );

    const result = [];

    for (
      let i = 0;
      i < sorted.length - 1;
      i++
    ) {

      const start =
        sorted[i];

      const end =
        sorted[i + 1];

      const segment =
        text.slice(
          start,
          end
        );

      if (!segment) {
        continue;
      }

      const styles =
        ranges
          .filter(
            range =>
              range.offset <= start &&
              range.offset +
                range.length >= end
          )
          .map(
            range =>
              range.style
          );

      result.push({
        text: segment,
        styles
      });

    }

    return result;
  }

  /*
   * ---------------------------------------------------------
   * Plain text
   * ---------------------------------------------------------
   */

  function renderInlinePlain(
    text,
    ranges
  ) {

    return getStyleRanges(
      text,
      ranges
    )
      .map(
        part =>
          part.text
      )
      .join('');
  }

  function renderMessagePlain(
    message
  ) {

    const parsed =
      parseMessage(
        message
      );

    if (
      parsed.type === 'raw'
    ) {

      return parsed.text;

    }

    return parsed.blocks
      .map(
        block =>
          renderInlinePlain(
            block.text || '',
            block.inlineStyleRanges
          )
      )
      .join('\n');
  }

  /*
   * ---------------------------------------------------------
   * Markdown
   * ---------------------------------------------------------
   */

  function renderInlineMarkdown(
    text,
    ranges
  ) {

    return getStyleRanges(
      text,
      ranges
    )
      .map(part => {

        let output =
          part.text;

        if (
          part.styles.includes(
            'CODE'
          )
        ) {

          output =
            '`' +
            output +
            '`';

        }

        if (
          part.styles.includes(
            'STRIKETHROUGH'
          )
        ) {

          output =
            '~~' +
            output +
            '~~';

        }

        if (
          part.styles.includes(
            'ITALIC'
          )
        ) {

          output =
            '*' +
            output +
            '*';

        }

        if (
          part.styles.includes(
            'BOLD'
          )
        ) {

          output =
            '**' +
            output +
            '**';

        }

        if (
          part.styles.includes(
            'UNDERLINE'
          )
        ) {

          output =
            '<u>' +
            output +
            '</u>';

        }

        return output;

      })
      .join('');
  }

  function renderMessageMarkdown(
    message
  ) {

    const parsed =
      parseMessage(
        message
      );

    if (
      parsed.type === 'raw'
    ) {

      return parsed.text;

    }

    return parsed.blocks
      .map(block => {

        const text =
          renderInlineMarkdown(
            block.text || '',
            block.inlineStyleRanges
          );

        switch (
          getBlockType(
            block
          )
        ) {

          case 'h1':
            return `# ${text}`;

          case 'h2':
            return `## ${text}`;

          case 'h3':
            return `### ${text}`;

          case 'h4':
            return `#### ${text}`;

          case 'h5':
            return `##### ${text}`;

          case 'h6':
            return `###### ${text}`;

          case 'ul':
            return `- ${text}`;

          case 'ol':
            return `1. ${text}`;

          case 'blockquote':
            return `> ${text}`;

          default:
            return text;
        }

      })
      .join('\n');
  }

  /*
   * ---------------------------------------------------------
   * Discord
   * ---------------------------------------------------------
   */

  function renderInlineDiscord(
    text,
    ranges
  ) {

    return getStyleRanges(
      text,
      ranges
    )
      .map(part => {

        let output =
          part.text;

        if (
          part.styles.includes(
            'CODE'
          )
        ) {

          output =
            '`' +
            output +
            '`';

        }

        if (
          part.styles.includes(
            'STRIKETHROUGH'
          )
        ) {

          output =
            '~~' +
            output +
            '~~';

        }

        if (
          part.styles.includes(
            'ITALIC'
          )
        ) {

          output =
            '*' +
            output +
            '*';

        }

        if (
          part.styles.includes(
            'BOLD'
          )
        ) {

          output =
            '**' +
            output +
            '**';

        }

        /*
         * Discord doesn't support HTML underline.
         *
         * Discord's __ syntax is underline.
         */
        if (
          part.styles.includes(
            'UNDERLINE'
          )
        ) {

          output =
            '__' +
            output +
            '__';

        }

        return output;

      })
      .join('');
  }

  function renderMessageDiscord(
    message
  ) {

    const parsed =
      parseMessage(
        message
      );

    if (
      parsed.type === 'raw'
    ) {

      return parsed.text;

    }

    return parsed.blocks
      .map(block => {

        const text =
          renderInlineDiscord(
            block.text || '',
            block.inlineStyleRanges
          );

        switch (
          getBlockType(
            block
          )
        ) {

          case 'h1':
            return `# ${text}`;

          case 'h2':
            return `## ${text}`;

          case 'h3':
            return `### ${text}`;

          /*
           * Discord has no H4-H6.
           */
          case 'h4':
          case 'h5':
          case 'h6':
            return `**${text}**`;

          case 'ul':
            return `- ${text}`;

          case 'ol':
            return `1. ${text}`;

          case 'blockquote':
            return `> ${text}`;

          default:
            return text;
        }

      })
      .join('\n');
  }

  /*
   * ---------------------------------------------------------
   * Google Docs HTML
   * ---------------------------------------------------------
   */

  function escapeHtml(
    text
  ) {

    return String(text)
      .replace(
        /&/g,
        '&amp;'
      )
      .replace(
        /</g,
        '&lt;'
      )
      .replace(
        />/g,
        '&gt;'
      )
      .replace(
        /"/g,
        '&quot;'
      );
  }

  function renderInlineHTML(
    text,
    ranges
  ) {

    return getStyleRanges(
      text,
      ranges
    )
      .map(part => {

        let output =
          escapeHtml(
            part.text
          );

        if (
          part.styles.includes(
            'CODE'
          )
        ) {

          output =
            `<code>${output}</code>`;

        }

        if (
          part.styles.includes(
            'STRIKETHROUGH'
          )
        ) {

          output =
            `<s>${output}</s>`;

        }

        if (
          part.styles.includes(
            'ITALIC'
          )
        ) {

          output =
            `<i>${output}</i>`;

        }

        if (
          part.styles.includes(
            'BOLD'
          )
        ) {

          output =
            `<strong>${output}</strong>`;

        }

        if (
          part.styles.includes(
            'UNDERLINE'
          )
        ) {

          output =
            `<u>${output}</u>`;

        }

        return output;

      })
      .join('');
  }

  function renderMessageHTML(
    message
  ) {

    const parsed =
      parseMessage(
        message
      );

    if (
      parsed.type === 'raw'
    ) {

      return escapeHtml(
        parsed.text
      );

    }

    let html = '';

    let orderedOpen =
      false;

    let unorderedOpen =
      false;

    for (
      const block of
        parsed.blocks
    ) {

      const type =
        getBlockType(
          block
        );

      const text =
        renderInlineHTML(
          block.text || '',
          block.inlineStyleRanges
        );

      if (
        type !== 'ol' &&
        orderedOpen
      ) {

        html += '</ol>';

        orderedOpen =
          false;
      }

      if (
        type !== 'ul' &&
        unorderedOpen
      ) {

        html += '</ul>';

        unorderedOpen =
          false;
      }

      switch (type) {

        case 'h1':
          html +=
            `<h1>${text}</h1>`;
          break;

        case 'h2':
          html +=
            `<h2>${text}</h2>`;
          break;

        case 'h3':
          html +=
            `<h3>${text}</h3>`;
          break;

        case 'h4':
          html +=
            `<h4>${text}</h4>`;
          break;

        case 'h5':
          html +=
            `<h5>${text}</h5>`;
          break;

        case 'h6':
          html +=
            `<h6>${text}</h6>`;
          break;

        case 'ul':

          if (!unorderedOpen) {
            html += '<ul>';
            unorderedOpen = true;
          }

          html +=
            `<li>${text}</li>`;

          break;

        case 'ol':

          if (!orderedOpen) {
            html += '<ol>';
            orderedOpen = true;
          }

          html +=
            `<li>${text}</li>`;

          break;

        case 'blockquote':

          html +=
            `<blockquote>${text}</blockquote>`;

          break;

        default:

          html +=
            `<p>${text || '&nbsp;'}</p>`;
      }
    }

    if (orderedOpen) {
      html += '</ol>';
    }

    if (unorderedOpen) {
      html += '</ul>';
    }

    return html;
  }

  /*
   * ---------------------------------------------------------
   * Headers
   * ---------------------------------------------------------
   */

  function getCommentHeader(
    comment
  ) {

    const author =
      comment.user?.alias ||
      'Unknown user';

    const start =
      fmtTime(
        comment.time
      );

    if (
      comment.timeEnd != null
    ) {

      return (
        `[${start} - ` +
        `${fmtTime(
          comment.timeEnd
        )}] ` +
        author
      );

    }

    return (
      `[${start}] ` +
      author
    );
  }

  /*
   * ---------------------------------------------------------
   * Render entire export
   * ---------------------------------------------------------
   */

  function sortComments(
    comments
  ) {

    return [...comments].sort(
      (a, b) =>
        (a.time || 0) -
          (b.time || 0) ||
        new Date(
          a.created || 0
        ) -
          new Date(
            b.created || 0
          )
    );
  }

  /*
   * Plain
   */

  function renderPlain(
    comments
  ) {

    const sections = [];

    for (
      const comment of
        sortComments(
          comments
        )
    ) {

      const section = [];

      section.push(
        getCommentHeader(
          comment
        )
      );

      section.push('');

      section.push(
  comment.recordingUrl
    ? '[Audio message]'
    : renderMessagePlain(
        comment.message
      )
);

      for (
        const reply of
          comment._replies || []
      ) {

        section.push('');

        section.push(
          `↳ Reply — ${getCommentHeader(
            reply
          )}`
        );

        section.push('');

        section.push(
          renderMessagePlain(
            reply.message
          )
        );
      }

      sections.push(
        section.join('\n')
      );
    }

    return sections.join(
      '\n\n---\n\n'
    );
  }

  /*
   * Markdown
   */

  function renderMarkdown(
    comments
  ) {

    const sections = [];

    for (
      const comment of
        sortComments(
          comments
        )
    ) {

      const section = [];

      section.push(
        getCommentHeader(
          comment
        )
      );

      section.push('');

      section.push(
  comment.recordingUrl
    ? '[Audio message]'
    : renderMessageMarkdown(
        comment.message
      )
);

      for (
        const reply of
          comment._replies || []
      ) {

        section.push('');

        /*
         * NO ">" HERE.
         */
        section.push(
          `↳ Reply — ${getCommentHeader(
            reply
          )}`
        );

        section.push('');

        section.push(
          renderMessageMarkdown(
            reply.message
          )
        );
      }

      sections.push(
        section.join('\n')
      );
    }

    return (
      sections.join(
        '\n\n---\n\n'
      ) +
      '\n'
    );
  }

  /*
   * Discord
   */

  function renderDiscord(
    comments
  ) {

    const sections = [];

    for (
      const comment of
        sortComments(
          comments
        )
    ) {

      const section = [];

      section.push(
        getCommentHeader(
          comment
        )
      );

      section.push('');

      section.push(
  comment.recordingUrl
    ? '[Audio message]'
    : renderMessageDiscord(
        comment.message
      )
);

      for (
        const reply of
          comment._replies || []
      ) {

        section.push('');

        /*
         * NO ">" HERE.
         */
        section.push(
          `↳ Reply — ${getCommentHeader(
            reply
          )}`
        );

        section.push('');

        section.push(
          renderMessageDiscord(
            reply.message
          )
        );
      }

      sections.push(
        section.join('\n')
      );
    }

    return sections.join(
      '\n\n---\n\n'
    );
  }

  /*
   * Google Docs
   */

  function renderGoogleHTML(
    comments
  ) {

    let html = '';

    const sorted =
      sortComments(
        comments
      );

    for (
      let i = 0;
      i < sorted.length;
      i++
    ) {

      const comment =
        sorted[i];

      const author =
        escapeHtml(
          comment.user?.alias ||
          'Unknown user'
        );

      const time =
        escapeHtml(
          getCommentHeader(
            comment
          )
        );

      html += `
        <div>
          <p>
            <strong>
              ${time}
            </strong>
          </p>

          ${
  comment.recordingUrl
    ? '<p><em>[Audio message]</em></p>'
    : renderMessageHTML(
        comment.message
      )
}
        </div>
      `;

      for (
        const reply of
          comment._replies || []
      ) {

        const replyAuthor =
          escapeHtml(
            getCommentHeader(
              reply
            )
          );

        html += `
          <div
            style="
              margin-left: 24px;
            "
          >

            <p>
              <strong>
                ↳ Reply — ${replyAuthor}
              </strong>
            </p>

            ${renderMessageHTML(
              reply.message
            )}

          </div>
        `;
      }

      if (
        i <
        sorted.length - 1
      ) {

        html +=
          '<hr>';
      }
    }

    return `
      <div>
        ${html}
      </div>
    `;
  }

  /*
   * ---------------------------------------------------------
   * Clipboard
   * ---------------------------------------------------------
   */

  async function copyText(
    text
  ) {

    await navigator.clipboard.writeText(
      text
    );
  }

  async function copyHTML(
    html,
    plainText
  ) {

    if (
      typeof ClipboardItem ===
      'undefined'
    ) {

      await copyText(
        plainText
      );

      return;
    }

    const item =
      new ClipboardItem({
        'text/html':
          new Blob(
            [html],
            {
              type:
                'text/html'
            }
          ),

        'text/plain':
          new Blob(
            [plainText],
            {
              type:
                'text/plain'
            }
          )
      });

    await navigator.clipboard.write([
      item
    ]);
  }

  /*
   * ---------------------------------------------------------
   * Download
   * ---------------------------------------------------------
   */

  function downloadFile(
    content,
    filename,
    mimeType
  ) {

    const blob =
      new Blob(
        [content],
        {
          type: mimeType
        }
      );

    const url =
      URL.createObjectURL(
        blob
      );

    const a =
      document.createElement(
        'a'
      );

    a.href = url;

    a.download =
      filename;

    document.body.appendChild(
      a
    );

    a.click();

    a.remove();

    setTimeout(
      () =>
        URL.revokeObjectURL(
          url
        ),
      1000
    );
  }

  /*
   * ---------------------------------------------------------
   * Export
   * ---------------------------------------------------------
   */

  async function exportComments(
  format
) {

  const videoId =
    getVideoIdFromUrl();

  if (!videoId) {
    throw new Error(
      'Could not find a video ID in the current URL.'
    );
  }

  let comments =
    await fetchComments(
      videoId,
      1000
    );

  if (
    comments.length === 1000
  ) {

    comments =
      await fetchComments(
        videoId,
        5000
      );
  }

  const replyCount =
    comments.reduce(
      (
        sum,
        comment
      ) =>
        sum +
        (
          comment.replyCount ||
          0
        ),
      0
    );

  if (
    replyCount > 0
  ) {

    comments =
      await attachReplies(
        videoId,
        comments
      );

  } else {

    comments =
      comments.map(
        comment => ({
          ...comment,
          _replies: []
        })
      );
  }

  const total =
    comments.reduce(
      (
        sum,
        comment
      ) =>
        sum +
        1 +
        (
          comment._replies
            ?.length || 0
        ),
      0
    );

  /*
   * Plain text
   */
  if (
    format === 'plain'
  ) {

    const text =
      renderPlain(
        comments
      );

    return {
      success: true,
      total,
      mime: 'text/plain',
      text,
      content: text,
      filename:
        `vod_review_comments_${videoId}.txt`
    };
  }

  /*
   * Markdown
   */
  if (
    format === 'markdown'
  ) {

    const text =
      renderMarkdown(
        comments
      );

    return {
      success: true,
      total,
      mime: 'text/plain',
      text,
      content: text,
      filename:
        `vod_review_comments_${videoId}.md`
    };
  }

  /*
   * Discord
   */
  if (
    format === 'discord'
  ) {

    const text =
      renderDiscord(
        comments
      );

    return {
      success: true,
      total,
      mime: 'text/plain',
      text,
      content: text,
      filename:
        `vod_review_comments_${videoId}_discord.txt`
    };
  }

  /*
   * Google Docs
   */
  if (
    format === 'google'
  ) {

    const html =
      renderGoogleHTML(
        comments
      );

    const text =
      renderPlain(
        comments
      );

    return {
      success: true,
      total,
      mime: 'text/html',
      html,
      text,
      content: html,
      filename:
        `vod_review_comments_${videoId}.html`
    };
  }

  throw new Error(
    `Unknown export format: ${format}`
  );
}

  /*
   * ---------------------------------------------------------
   * Popup communication
   * ---------------------------------------------------------
   */

chrome.runtime.onMessage.addListener(
  (
    request,
    sender,
    sendResponse
  ) => {

    if (
      request?.action !==
      'exportComments'
    ) {
      return;
    }

    exportComments(
      request.format
    )
      .then(
        result => {
          sendResponse(
            result
          );
        }
      )
      .catch(
        error => {

          console.error(
            '[Insights VOD Comment Exporter]',
            error
          );

          sendResponse({
            success: false,
            error:
              error?.message ||
              String(error)
          });

        }
      );

    /*
     * Important:
     * keep the message channel open
     * for the async GraphQL requests.
     */
    return true;
  }
);

})();