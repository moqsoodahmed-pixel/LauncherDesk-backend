const safePagination = ({ maxLimit = 50, defaultLimit = 20 } = {}) => (req, _res, next) => {
  let page  = parseInt(req.query.page,  10)
  let limit = parseInt(req.query.limit, 10)
  if (isNaN(page)  || page  < 1) page  = 1
  if (isNaN(limit) || limit < 1) limit = defaultLimit
  if (limit > maxLimit)          limit = maxLimit
  req.query.page  = page
  req.query.limit = limit
  next()
}
module.exports = { safePagination }
