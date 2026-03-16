defmodule Blog.Components.PostPreview do
  use Hologram.Component

  alias Hologram.UI.Link

  prop(:post, :map)

  def template do
    ~HOLO"""
    <article class="post-preview">
      <h2>
        <Link to={Blog.PostPage, id: @post.id}>{@post.title}</Link>
      </h2>
      {%if @post.excerpt}
        <p class="excerpt">{@post.excerpt}</p>
      {%else}
        <p class="excerpt">No preview available.</p>
      {/if}
      <div class="meta">
        <span class="likes">{@post.likes} likes</span>
      </div>
    </article>
    """
  end
end
