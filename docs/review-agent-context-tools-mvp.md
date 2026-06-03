there are 4 things that I want to do for the mvp and these 4 things are essentially different tools that I wanna give to the agent for it to be able to analyze diffs in the most efficient way.

first, which is relatively easy to give is full scope context around diff chunks. basically for each diff we not only give a diff + several lines of code surrouding it, but rather we detect all functions that this diff touches and include the full context of all these functions. if a function is inside a class we include the full class as well.

second, we need to provide agent with tools that would allow it to get definition and callers of each symbol it wants. we can create a functions that will be based on AST analysis where the agent can input the symbol name (e.g. function name) and get either full definition of the symbol or a list of call sites with mentions of who calls where.

third, we will need to chunk the code by flies, classes and then functions and then embed them into vector db. before agent starts doing the review we query for top closes chunks similar to the diffs (which we also should've indexed by this moment) and give them to the agent as well.
