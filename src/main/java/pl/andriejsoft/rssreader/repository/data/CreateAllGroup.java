package pl.andriejsoft.rssreader.repository.data;

import io.mongock.api.annotations.ChangeUnit;
import io.mongock.api.annotations.Execution;
import io.mongock.api.annotations.RollbackExecution;
import pl.andriejsoft.rssreader.document.Group;
import pl.andriejsoft.rssreader.repository.GroupRepository;
import pl.andriejsoft.rssreader.repository.UserRepository;

@ChangeUnit(id = "createAllGroup", order = "002", author = "mongock")
public class CreateAllGroup {

    private final UserRepository userRepository;
    private final GroupRepository groupRepository;

    public CreateAllGroup(GroupRepository groupRepository, UserRepository userRepository) {
        this.groupRepository = groupRepository;
        this.userRepository = userRepository;
    }

    @Execution
    public void changeSet() {

        userRepository.findByUserName("DEFAULT").ifPresent(user -> groupRepository.save(Group.builder()
                .code("ALL")
                .description("ALL")
                .userUuid(user.getUuid())
                .build()));
    }

    @RollbackExecution
    public void rollback() {
    }
}
