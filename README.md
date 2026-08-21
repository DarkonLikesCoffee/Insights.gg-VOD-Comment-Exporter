# Insights.gg VOD Comment Exporter v2.1

This build fixes reply extraction using the exact response structure captured from Insights.gg.

The replies endpoint returns:
`data.video.comment.queryReplies.replies`

and those objects have `__typename: "CommentReply"`.

It also supports header levels 1–6 and exports author, ID, creation time, likes, reply count and VOD time range.

Install through `chrome://extensions/` -> Developer mode -> Load unpacked.
