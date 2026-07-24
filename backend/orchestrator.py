import logging

from strands import Agent
from strands.multiagent import GraphBuilder, GraphResult

from backend.agents import (
    create_page_agent,
    create_profile_agent,
    create_memory_agent,
    create_answer_agent,
    create_fill_agent,
    create_learning_agent,
)

logger = logging.getLogger(__name__)


class ApplyPilotOrchestrator:
    def __init__(self, llm_agent: Agent):
        self.llm_agent = llm_agent
        self._static_fill_graph: GraphBuilder | None = None
        self._answer_graph: GraphBuilder | None = None
        self._learning_graph: GraphBuilder | None = None

    def build_graphs(self):
        page_agent = create_page_agent()
        profile_agent = create_profile_agent()
        memory_agent = create_memory_agent()
        answer_agent = create_answer_agent()
        fill_agent = create_fill_agent()
        learning_agent = create_learning_agent()

        graph_builder = GraphBuilder()
        graph_builder.add_node(page_agent, "page")
        graph_builder.add_node(profile_agent, "profile")
        graph_builder.add_node(memory_agent, "memory")
        graph_builder.add_node(answer_agent, "answer")
        graph_builder.add_node(fill_agent, "fill")
        graph_builder.add_node(learning_agent, "learning")

        graph_builder.add_edge("page", "profile")
        graph_builder.add_edge("page", "memory")
        graph_builder.add_edge("memory", "answer")
        graph_builder.add_edge("profile", "answer")
        graph_builder.add_edge("answer", "fill")
        graph_builder.add_edge("fill", "learning")

        graph_builder.set_entry_point("page")
        graph_builder.set_execution_timeout(300)
        self._graph = graph_builder.build()
        logger.info("agent graphs built")

    async def process_page(self, url: str, fields: list[dict]) -> GraphResult | None:
        if not self._graph:
            self.build_graphs()
        task = f"Analyze and process job application at {url} with fields: {fields}"
        return await self._graph.invoke_async(task)

    async def handle_answer_edit(self, question: str, original: str, edited: str, company: str, role: str) -> GraphResult | None:
        if not self._graph:
            self.build_graphs()
        task = (
            f"Learn from edited answer. Question: {question}. "
            f"Original: {original}. Edited: {edited}. Company: {company}. Role: {role}."
        )
        return await self._graph.invoke_async(task)


orchestrator = ApplyPilotOrchestrator(llm_agent=None)
