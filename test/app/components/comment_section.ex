defmodule Blog.Components.CommentSection do
  use Hologram.Component

  prop :comments, :list, default: []
  prop :new_comment, :string, default: ""

  def template do
    ~HOLO"""
    <section class="comment-section">
      <h3>Comments</h3>

      {%if length(@comments) == 0}
        <p class="no-comments">No comments yet. Be the first!</p>
      {/if}

      {%for comment <- @comments}
        <div class="comment">
          <strong>{comment.author}</strong>
          <p>{comment.text}</p>
        </div>
      {/for}

      <form $submit="submit_comment" class="comment-form">
        <textarea
          value={@new_comment}
          placeholder="Write a comment..."
          $change="update_comment"
        />
        <button type="submit">Post Comment</button>
      </form>
    </section>
    """
  end
end
