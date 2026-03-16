defmodule Blog.Components.PlacePreview do
  use Hologram.Component

  alias Hologram.UI.Link

  alias Octafest.Platform.Place

  prop(:place, Place)

  def template do
    ~HOLO"""
    <article class="post-preview">
      <h2>
        <Link>{@place.asdfads}</Link>
      </h2>
    </article>
    """
  end
end
