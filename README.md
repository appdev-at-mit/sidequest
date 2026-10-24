# Backend

So basically, you should now be able to integrate this with whatever part of the frontend you are working on. The following API endpoints are implemented:

- `/api/signup` (POST): supply `kerb`, `name`, `password` in your request, creates a new user with these credentials, but does not log in. `kerb` must not appear elsewhere in the database.

- `/api/login` (POST): supply `kerb`, `password`, logs in to the user with kerb equal to `kerb` if the password is correct. Saves a session for future requests.

- `/api/logout` (DELETE): logs out of current session.

- `/api/get-all-requests` (GET): returns, in a rather crude JSON format, all requests in the database. Must be logged in.

- `/api/post-request` (POST): supply `requester`, `description`, `pay`, `start`, `end` (requester's kerb, description, how much money you would pay, start location, end location), adds a new request to the database. Must be logged in.

- `/api/toggle-block` (POST): supply `dest`, and blocks the user with kerb `dest` if they are not currently blocked; unblocks them if they are currently blocked. Must be logged in.

How do you test this?

Install Node.js and Docker. Now once you have cloned the repository locally, navigate to it in a terminal and run `docker compose up -d`.

You should specify environment variables `MONGODB_URI` and `SECRET`: for `MONGODB_URI`, set it to `mongodb://127.0.0.1:27017/myapp_dev`. `SECRET` should be set to some cryptographically secure string, for instance you can obtain one by running `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` in your terminal.

Finally, run `node api.js` in your terminal. This will start the server locally. You can now access the root via `localhost:3000`. If you want to specify a new frontend page, do something like:

```
app.get(URL, async (req, res) => {
  res.status(200).send(HTML_CODE, {
    "Content-type": "text/html"
  })
})
```

in `api.js`
