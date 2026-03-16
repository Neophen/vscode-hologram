defmodule Blog.HomePage do
  use Hologram.Page

  alias Blog.Components.PostPreview
  alias Blog.Components.SearchBar

  route "/"
  layout Blog.MainLayout

  def init(_params, component, _server) do
    posts = [
      %{id: 1, title: "Getting Started with Hologram", excerpt: "Learn the basics of building apps with Hologram", likes: 12},
      %{id: 2, title: "State Management in Hologram", excerpt: "Understanding client-side state and server commands", likes: 8},
      %{id: 3, title: "Building Components", excerpt: "Create reusable UI components with props and slots", likes: 15}
    ]

    put_state(component, :posts, posts)
  end

  def init(_params, component) do
    put_state(component, :search_query, "")
  end

  def action(:update_search, params, component) do
    put_state(component, :search_query, params.value)
  end

  def template do
    ~HOLO"""
    <div class="home-page">
      <h1>Welcome to my Blog</h1>

      <SearchBar query={@search_query} $change="update_search" />

      <div class="posts">
        {%for post <- @posts}
          <PostPreview post={post} />
        {/for}
      </div>
    </div>
    """
  end
end
