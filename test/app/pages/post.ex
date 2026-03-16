defmodule Blog.PostPage do
  use Hologram.Page

  alias Blog.Components.CommentSection
  alias Blog.Components.LikeButton

  route("/posts/:id")
  param(:id, :integer)
  layout(Blog.MainLayout)

  def init(params, component, _server) do
    post = %{
      id: params.id,
      title: "Example Post",
      content: "This is the full content of the blog post...",
      author: "Jane Doe",
      likes: 0,
      comments: []
    }

    put_state(component, :post, post)
  end

  def init(_params, component) do
    component
    |> put_state(:show_comments, false)
    |> put_state(:new_comment, "")
  end

  def action(:like_post, _params, component) do
    component
    |> put_state([:post, :likes], component.state.post.likes + 1)
    |> put_command(:save_like, post_id: component.state.post.id)
  end

  def action(:toggle_comments, _params, component) do
    put_state(component, :show_comments, !component.state.show_comments)
  end

  def action(:update_comment, params, component) do
    put_state(component, :new_comment, params.value)
  end

  def action(:submit_comment, _params, component) do
    comment = %{
      text: component.state.new_comment,
      author: "Anonymous",
      created_at: DateTime.utc_now()
    }

    component
    |> put_state([:post, :comments], [comment | component.state.post.comments])
    |> put_state(:new_comment, "")
    |> put_command(:save_comment, post_id: component.state.post.id, text: comment.text)
  end

  def command(:save_like, params, server) do
    Blog.Posts.increment_likes(params.post_id)
    server
  end

  def command(:save_comment, params, server) do
    Blog.Posts.add_comment(params.post_id, params.text)
    server
  end

  def template do
    ~HOLO"""
    <article class="post-page">
      <header>
        <h1>{@post.title}</h1>
        <span class="author">By {@post.author}</span>
      </header>

      <div class="post-content">
        <p>{@post.content}</p>
      </div>

      <div class="post-actions">
        <LikeButton count={@post.}  />

        <button $click="toggle_comments" class="comment-toggle">
          {%if @show_comments}
            Hide Comments
          {%else}
            Show Comments ({length(@post.comments)})
          {/if}
        </button>
      </div>

      {%if @show_comments}
        <CommentSection
          cid="comments"
          comments={@post.comments}
          new_comment={@new_comment}
          $change="update_comment"
          $submit="submit_comment"
          $click=
        />
      {/if}
    </article>
    """
  end
end
