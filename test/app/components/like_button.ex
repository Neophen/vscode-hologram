defmodule Blog.Components.LikeButton do
  use Hologram.Component

  prop(:count, :integer, default: 0)
  prop(:on_click, :string, required: true)

  def template do
    ~HOLO"""
    <button class="like-button" $click={@on_click}>
      &#x2764; {@count}
    </button>
    """
  end
end
