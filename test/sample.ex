defmodule MyApp.Components.Counter do
  use Hologram.Component

  prop(:initial_count, :integer, default: 0)

  def init(_props, component, _server) do
    put_state(component, :count, 0)
  end

  def action(:increment, _params, component) do
    component
    |> put_state(:count, component.state.count + 1)
  end

  def action(:decrement, _params, component) do
    component
    |> put_state(:count, component.state.count - 1)
  end

  def action(:reset, _params, component) do
    component
    |> put_state(:count, 0)
  end

  def template do
    ~HOLO"""
    <div class="counter">
      <h2>Counter: {@count}</h2>

      {%if @count > 0}
        <p>Count is positive</p>
      {%else if @count < 0}
        <p>Count is negative</p>
      {%else}
        <p>Count is zero</p>
      {/if}

      <button $click="increment">+</button>
      <button $click="decrement">-</button>
      <button $click="reset">Reset</button>
      <button $click={:increment, by: 5}>+5</button>

      <ul>
        {%for i <- 1..@count}
          <li>Item {i}</li>
        {/for}
      </ul>
    </div>
    """
  end
end

defmodule MyApp.Components.TodoCheckbox do
  use Hologram.Component

  prop(:todo, :map)

  def init(props, component, _server) do
    put_state(component, :todo, props.todo)
  end

  def template do
    ~HOLO"""
    <li>
      <input type="checkbox" id={@todo.id} $change="toggle_done" checked={@todo.done} />
      <label for={@todo.id} class={class(@todo.done)}>{@todo.title}</label>
    </li>
    """
  end

  def action(:toggle_done, %{event: %{value: value}}, component) do
    component
    |> put_state([:todo, :done], value)
    |> put_command(:toggle_done, todo: component.state.todo)
  end

  def command(:toggle_done, params, server) do
    if params.todo.done do
      Todos.List.set_done!(params.todo.id)
    else
      Todos.List.set_undone!(params.todo.id)
    end

    put_action(server, name: :reload_page, target: "page")
  end

  defp class(true), do: "done"

  defp class(false), do: nil
end

defmodule MyApp.Pages.Home do
  use Hologram.Page

  alias MyApp.Components.Counter
  alias MyApp.Components.TodoCheckbox
  alias Hologram.UI.Link

  route("/")
  layout(MyApp.Layouts.Main)

  def init(_params, component, _server) do
    put_state(component, :title, "Home Page")
    put_state(component, :search_query, "")
    put_state(component, :posts, [])
  end

  def action(:update_search, %{event: %{value: value}}, component) do
    component
    |> put_state(:search_query, value)
  end

  def template do
    ~HOLO"""
    <div>
      <h1>{@title}</h1>

      <SearchBar query={@search_query} $change="update_search" $click= />

      <div class="posts">
        {%for post <- @posts}
          <PostPreview post={post} />
        {/for}
      </div>

      <Counter cid="main_counter" initial_count={5} />
      <TodoCheckbox todo={%{id: 1, title: "Test", done: false}} />

      <Link to={MyApp.Pages.PostPage}>View Post</Link>
      <Link to={MyApp.Pages.PostPage, id: 1}>View Post 1</Link>
    </div>
    """
  end
end

defmodule MyApp.Pages.PostPage do
  use Hologram.Page

  route("/posts/:id")
  param(:id, :integer)
  layout(MyApp.Layouts.Main)

  def init(params, component, _server) do
    post = %{
      id: params.id,
      title: "Example Post",
      content: "This is the full content...",
      likes: 0
    }

    put_state(component, :post, post)
  end

  def template do
    ~HOLO"""
    <article>
      <h1>{@post.title}</h1>
      <p>{@post.content}</p>

      <div class="likes">
        Likes: {@post.likes}
        <button $click="like_post">Like</button>
      </div>
    </article>
    """
  end

  def action(:like_post, _params, component) do
    component
    |> put_state([:post, :likes], component.state.post.likes + 1)
    |> put_command(:save_like, post_id: component.state.post.id)
  end

  def command(:save_like, params, server) do
    IO.puts("Liked post #{params.post_id}")
    server
  end
end

defmodule MyApp.Layouts.Main do
  use Hologram.Component

  alias Hologram.UI.Runtime

  def template do
    ~HOLO"""
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>My App</title>
        <Runtime />
      </head>
      <body>
        <nav>
          <Link to={MyApp.Pages.Home}>Home</Link>
        </nav>
        <main>
          <slot />
        </main>
      </body>
    </html>
    """
  end
end
