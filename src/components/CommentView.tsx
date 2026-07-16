import { useCallback, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { DiagramComment } from '../types/diagram';
import { MIN_COMMENT_HEIGHT, MIN_COMMENT_WIDTH } from '../types/diagram';

interface CommentViewProps {
  comment: DiagramComment;
  /** Canvas zoom — world coords render at `coord * zoom`, matching nodes. */
  zoom: number;
  readOnly: boolean;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onChangeText: (id: string, text: string) => void;
  onDelete: (id: string) => void;
  /** Called on interaction start so the store can open a fresh undo entry. */
  onInteractStart: () => void;
}

/**
 * A draggable, resizable explanatory note rendered behind the nodes. Comments
 * are inert — no ports, no signal flow, ignored by codegen — so this component
 * only handles its own move/resize/edit/delete and never touches connections.
 */
export function CommentView({
  comment,
  zoom,
  readOnly,
  onMove,
  onResize,
  onChangeText,
  onDelete,
  onInteractStart,
}: CommentViewProps) {
  // Drag/resize origin captured on pointer-down: pointer position plus the
  // comment's world geometry at that moment. Screen deltas convert to world
  // deltas by dividing out the zoom.
  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const beginMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.stopPropagation();
      event.preventDefault();
      (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
      onInteractStart();
      dragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: comment.x,
        startY: comment.y,
        startWidth: comment.width,
        startHeight: comment.height,
      };
    },
    [comment.x, comment.y, comment.width, comment.height, onInteractStart, readOnly],
  );

  const handleMovePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = (event.clientX - drag.startClientX) / zoom;
      const dy = (event.clientY - drag.startClientY) / zoom;
      onMove(comment.id, drag.startX + dx, drag.startY + dy);
    },
    [comment.id, onMove, zoom],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dw = (event.clientX - drag.startClientX) / zoom;
      const dh = (event.clientY - drag.startClientY) / zoom;
      onResize(
        comment.id,
        Math.max(MIN_COMMENT_WIDTH, drag.startWidth + dw),
        Math.max(MIN_COMMENT_HEIGHT, drag.startHeight + dh),
      );
    },
    [comment.id, onResize, zoom],
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
  }, []);

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (readOnly) return;
      event.stopPropagation();
      event.preventDefault();
      (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
      onInteractStart();
      dragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: comment.x,
        startY: comment.y,
        startWidth: comment.width,
        startHeight: comment.height,
      };
    },
    [comment.x, comment.y, comment.width, comment.height, onInteractStart, readOnly],
  );

  return (
    <div
      className="diagram-comment"
      style={{
        left: `${comment.x * zoom}px`,
        top: `${comment.y * zoom}px`,
        width: `${comment.width * zoom}px`,
        height: `${comment.height * zoom}px`,
        fontSize: `${13 * zoom}px`,
      }}
      // Keep canvas panning/selection from starting under the comment.
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div
        className="diagram-comment-bar"
        onPointerDown={beginMove}
        onPointerMove={handleMovePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title="Drag to move"
      >
        <span className="diagram-comment-grip" aria-hidden="true">
          ⠿
        </span>
        {!readOnly && (
          <button
            type="button"
            className="diagram-comment-delete"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onDelete(comment.id)}
            aria-label="Delete comment"
            title="Delete comment"
          >
            ✕
          </button>
        )}
      </div>
      <textarea
        className="diagram-comment-text"
        value={comment.text}
        readOnly={readOnly}
        placeholder="Write a note…"
        onChange={(event) => onChangeText(comment.id, event.target.value)}
        // Let clicks land in the textarea to edit without moving the box.
        onPointerDown={(event) => event.stopPropagation()}
      />
      {!readOnly && (
        <div
          className="diagram-comment-resize"
          onPointerDown={beginResize}
          onPointerMove={handleResizePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          aria-hidden="true"
          title="Drag to resize"
        />
      )}
    </div>
  );
}
